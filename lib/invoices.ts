import { randomBytes } from "crypto";
import { getPool, withTransaction } from "./db";
import { createPaymentUri, getHorizonServer, getStellarConfig, getTransactionMemo, normalizeStellarAmount, stellarAmountToStroops } from "./stellar";
import { ensureWalletForUser, getWallet, type WalletRecord } from "./wallets";
import { recordAuditEvent } from "./audit";
import { captureException } from "./observability";

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "VIEWED"
  | "PAYMENT_PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "AMOUNT_MISMATCH"
  | "EXPIRED"
  | "CANCELED";

export type InvoiceRecord = {
  id: string;
  user_id: string;
  invoice_number: string;
  client_name: string;
  client_email: string | null;
  client_country: string | null;
  amount: string;
  currency: "USD";
  description: string;
  due_date: string | null;
  line_items: Array<{ description: string; qty: string; rate: string; total: string }>;
  purpose_code: string;
  status: InvoiceStatus;
  paid_at: string | null;
  created_at: string;
};

export type PaymentIntentRecord = {
  id: string;
  invoice_id: string;
  slug: string;
  rail: "STELLAR";
  network: "STELLAR_MAINNET";
  asset_code: "USDC";
  asset_issuer: string;
  expected_amount: string;
  received_amount: string;
  payment_address: string;
  payment_reference: string;
  payment_uri: string;
  status: string;
  expires_at: string;
};

type CreateLineItem = { description?: unknown; qty?: unknown; rate?: unknown };

const MAX_LINE_ITEMS = 25;
const STROOPS = 10_000_000n;

function amountFromStroops(value: bigint) {
  const whole = value / STROOPS;
  const fraction = (value % STROOPS).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

function decimalQuantity(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw new Error("Line item quantity must be a positive number with up to three decimal places.");
  const [whole, fraction = ""] = raw.split(".");
  const scaled = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  if (scaled <= 0n || scaled > 10_000_000n) throw new Error("Line item quantity is outside the allowed range.");
  return { scaled, display: `${whole.replace(/^0+(?=\d)/, "") || "0"}.${fraction.padEnd(3, "0")}` };
}

/** Uses integer arithmetic so client-submitted totals can never change an invoice. */
export function calculateInvoiceLineItems(input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_LINE_ITEMS) {
    throw new Error(`Include between 1 and ${MAX_LINE_ITEMS} line items.`);
  }
  let total = 0n;
  const lineItems = input.map((item) => {
    const row = (item || {}) as CreateLineItem;
    const description = String(row.description || "").trim();
    if (!description || description.length > 240) throw new Error("Each line item description must be between 1 and 240 characters.");
    const quantity = decimalQuantity(row.qty);
    const rate = normalizeStellarAmount(row.rate);
    const lineTotal = (stellarAmountToStroops(rate) * quantity.scaled) / 1_000n;
    if (lineTotal <= 0n) throw new Error("Each line item total must be greater than zero.");
    total += lineTotal;
    return { description, qty: quantity.display, rate, total: amountFromStroops(lineTotal) };
  });
  if (total <= 0n) throw new Error("Invoice total must be greater than zero.");
  return { lineItems, amount: amountFromStroops(total) };
}

function validateInput(input: Record<string, unknown>) {
  const clientName = String(input.clientName || "").trim();
  const clientEmail = String(input.clientEmail || "").trim().toLowerCase() || null;
  const clientCountry = String(input.clientCountry || "").trim().toUpperCase() || null;
  const description = String(input.description || "").trim();
  const purposeCode = String(input.purposeCode || "").trim().toUpperCase();
  if (!clientName || clientName.length > 120) throw new Error("Client name must be between 1 and 120 characters.");
  if (clientEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) || clientEmail.length > 254)) throw new Error("Enter a valid client email address.");
  if (clientCountry && !/^[A-Z]{2}$/.test(clientCountry)) throw new Error("Client country must be a two-letter country code.");
  if (!description || description.length > 1_000) throw new Error("Description must be between 1 and 1000 characters.");
  if (!purposeCode) throw new Error("Purpose code is required.");
  const { lineItems, amount } = calculateInvoiceLineItems(input.lineItems);
  let dueDate: Date | null = null;
  if (input.dueDate) {
    dueDate = new Date(String(input.dueDate));
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now() || dueDate.getTime() > Date.now() + 365 * 24 * 60 * 60_000) {
      throw new Error("Due date must be within the next 12 months.");
    }
  }
  return { clientName, clientEmail, clientCountry, description, purposeCode, lineItems, amount, dueDate };
}

async function nextInvoiceNumber(client: import("pg").PoolClient, userId: string) {
  const year = new Date().getUTCFullYear();
  const result = await client.query<{ last_value: number }>(
    `INSERT INTO invoice_sequences (user_id, period_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, period_year) DO UPDATE SET last_value = invoice_sequences.last_value + 1
     RETURNING last_value`,
    [userId, year],
  );
  return `INV-${year}-${String(result.rows[0].last_value).padStart(4, "0")}`;
}

async function assertInvoicesEnabled() {
  const result = await getPool().query<{ is_paused: boolean; reason: string | null }>(
    `SELECT is_paused, reason FROM operator_controls WHERE control_key = 'INVOICES'`,
  );
  const control = result.rows[0];
  if (control?.is_paused) throw new Error(control.reason || "Invoice creation is temporarily paused.");
}

export async function createInvoice(input: Record<string, unknown>, userId: string, idempotencyKey: string) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new Error("Use a valid Idempotency-Key when creating an invoice.");
  await assertInvoicesEnabled();
  const validated = validateInput(input);
  const profile = await getPool().query<{ account_state: string }>("SELECT account_state FROM account_profiles WHERE user_id = $1", [userId]);
  if (!profile.rows[0] || ["PENDING_PASSKEY", "SUSPENDED", "RECOVERY_REVIEW"].includes(profile.rows[0].account_state)) {
    throw new Error("Enroll and verify a passkey before creating payment links.");
  }
  const purpose = await getPool().query<{ code: string }>("SELECT code FROM purpose_codes WHERE code = $1 AND active = TRUE", [validated.purposeCode]);
  if (!purpose.rowCount) throw new Error("Select a supported purpose code.");
  const wallet = await ensureWalletForUser({ userId });
  if (wallet.provision_status !== "READY" || wallet.policy_state !== "ENFORCED") {
    throw new Error("Your Fireblocks wallet is not ready for Mainnet payment links yet.");
  }
  const config = getStellarConfig();

  const created = await withTransaction(async (client) => {
    const previous = await client.query<{ invoice: InvoiceRecord; payment_intent: PaymentIntentRecord }>(
      `SELECT row_to_json(i.*) AS invoice, row_to_json(pi.*) AS payment_intent
       FROM invoices i JOIN payment_intents pi ON pi.invoice_id = i.id
       WHERE i.user_id = $1 AND i.idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (previous.rows[0]) return previous.rows[0];
    const invoiceNumber = await nextInvoiceNumber(client, userId);
    const slug = randomBytes(16).toString("hex");
    const reference = `RUPI-${randomBytes(8).toString("hex").toUpperCase()}`;
    const paymentUri = createPaymentUri({ destination: wallet.public_key, amount: validated.amount, memo: reference, config });
    const expiresAt = new Date(Math.min(
      validated.dueDate?.getTime() || Date.now() + 14 * 24 * 60 * 60_000,
      Date.now() + 90 * 24 * 60 * 60_000,
    )).toISOString();
    const result = await client.query<{ invoice: InvoiceRecord; payment_intent: PaymentIntentRecord }>(
      `WITH invoice AS (
         INSERT INTO invoices (
           user_id, invoice_number, client_name, client_email, client_country, amount, description,
           due_date, line_items, purpose_code, status, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'SENT', $11)
         RETURNING *
       ), intent AS (
         INSERT INTO payment_intents (
           user_id, invoice_id, wallet_id, slug, asset_issuer, expected_amount, payment_address,
           payment_reference, payment_uri, expires_at
         ) SELECT $1, invoice.id, $12, $13, $14, $6, $15, $16, $17, $18 FROM invoice
         RETURNING *
       )
       SELECT row_to_json(invoice.*) AS invoice, row_to_json(intent.*) AS payment_intent FROM invoice, intent`,
      [
        userId, invoiceNumber, validated.clientName, validated.clientEmail, validated.clientCountry,
        validated.amount, validated.description, validated.dueDate?.toISOString() || null,
        JSON.stringify(validated.lineItems), validated.purposeCode, idempotencyKey, wallet.id, slug,
        config.assetIssuer, wallet.public_key, reference, paymentUri, expiresAt,
      ],
    );
    return result.rows[0];
  });
  await recordAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    type: "INVOICE_CREATED",
    message: "A Stellar Mainnet USDC payment link was created.",
    metadata: { invoiceId: created.invoice.id, amount: created.invoice.amount },
  });
  return created;
}

export async function listInvoices(userId: string) {
  const result = await getPool().query(
    `SELECT i.*, row_to_json(pi.*) AS payment_intent
     FROM invoices i LEFT JOIN payment_intents pi ON pi.invoice_id = i.id
     WHERE i.user_id = $1 ORDER BY i.created_at DESC LIMIT 100`,
    [userId],
  );
  return result.rows;
}

export async function getInvoice(id: string, userId: string) {
  const result = await getPool().query(
    `SELECT i.*, row_to_json(pi.*) AS payment_intent,
       COALESCE((SELECT json_agg(a ORDER BY a.created_at) FROM audit_events a WHERE a.metadata->>'invoiceId' = i.id::text), '[]'::json) AS audit_events
     FROM invoices i LEFT JOIN payment_intents pi ON pi.invoice_id = i.id
     WHERE i.id = $1 AND i.user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

/** Public, cacheable, side-effect-free payment view. */
export async function getPublicPayment(slug: string) {
  if (!/^[a-f0-9]{32}$/i.test(slug)) return null;
  const result = await getPool().query(
    `SELECT i.invoice_number, i.client_name, i.amount, i.currency, i.description, i.due_date, i.line_items,
       i.purpose_code,
       CASE WHEN pi.expires_at <= NOW() AND pi.status <> 'PAID' THEN 'EXPIRED' ELSE i.status END AS invoice_status,
       pi.slug, pi.rail, pi.network, pi.asset_code, pi.asset_issuer, pi.expected_amount, pi.received_amount,
       pi.payment_address, pi.payment_reference, pi.payment_uri,
       CASE WHEN pi.expires_at <= NOW() AND pi.status <> 'PAID' THEN 'EXPIRED' ELSE pi.status END AS status,
       pi.expires_at
     FROM payment_intents pi JOIN invoices i ON i.id = pi.invoice_id WHERE pi.slug = $1`,
    [slug],
  );
  return result.rows[0] ?? null;
}

export async function expireInvoices() {
  const result = await getPool().query<{ id: string; user_id: string }>(
    `UPDATE payment_intents pi SET status = 'EXPIRED', updated_at = NOW()
     FROM invoices i
     WHERE i.id = pi.invoice_id AND pi.expires_at <= NOW() AND pi.status <> 'PAID' AND pi.status <> 'EXPIRED'
     RETURNING i.id, i.user_id`,
  );
  if (result.rowCount) {
    await getPool().query(
      `UPDATE invoices SET status = 'EXPIRED', updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND status <> 'PAID'`,
      [result.rows.map((row) => row.id)],
    );
  }
  return result.rowCount || 0;
}

type HorizonPayment = {
  id: string;
  type: string;
  transaction_hash: string;
  paging_token?: string;
  to?: string;
  from?: string;
  amount?: string;
  asset_code?: string;
  asset_issuer?: string;
  created_at?: string;
  transaction_successful?: boolean;
  ledger?: number;
};

function validLedgerTime(value: string | undefined, wallet: WalletRecord) {
  const time = value ? Date.parse(value) : Number.NaN;
  const created = Date.parse(wallet.created_at);
  return Number.isFinite(time) && (!Number.isFinite(created) || time >= created - 60_000) && time <= Date.now() + 5 * 60_000;
}

async function persistOperation({ wallet, payment, memo }: { wallet: WalletRecord; payment: HorizonPayment; memo: string | null }) {
  const config = getStellarConfig();
  if (
    payment.type !== "payment" || payment.transaction_successful !== true || payment.to !== wallet.public_key ||
    payment.asset_code !== "USDC" || payment.asset_issuer !== config.assetIssuer ||
    !payment.amount || !validLedgerTime(payment.created_at, wallet)
  ) return false;
  const amount = normalizeStellarAmount(payment.amount);
  return withTransaction(async (client) => {
    const intents = await client.query<{
      id: string; invoice_id: string; user_id: string; expected_amount: string; status: string; expires_at: string; received_amount: string;
    }>(
      `SELECT id, invoice_id, user_id, expected_amount::text, status, expires_at, received_amount::text
       FROM payment_intents
       WHERE wallet_id = $1 AND payment_reference = $2 FOR UPDATE`,
      [wallet.id, memo || ""],
    );
    const intent = intents.rows[0];
    const expired = intent && Date.parse(intent.expires_at) <= Date.now() && intent.status !== "PAID";
    if (expired && intent) {
      await client.query("UPDATE payment_intents SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1", [intent.id]);
      await client.query("UPDATE invoices SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1 AND status <> 'PAID'", [intent.invoice_id]);
    }
    const operation = await client.query<{ id: string }>(
      `INSERT INTO stellar_operations (
        operation_id, transaction_hash, user_id, wallet_id, invoice_id, payment_intent_id,
        kind, direction, status, asset_code, asset_issuer, amount, memo, source_address,
        destination_address, ledger_sequence, ledger_closed_at, raw_payload, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PAYMENT', 'IN', 'CONFIRMED', 'USDC', $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
      ON CONFLICT (operation_id) DO NOTHING RETURNING id`,
      [
        payment.id, payment.transaction_hash, wallet.user_id, wallet.id, expired ? null : intent?.invoice_id || null,
        expired ? null : intent?.id || null, config.assetIssuer, amount, memo, payment.from || null,
        payment.to || null, payment.ledger || null,
        payment.created_at || null,
        JSON.stringify({ source: "horizon", operationId: payment.id, transactionHash: payment.transaction_hash }),
        payment.created_at,
      ],
    );
    if (!operation.rowCount || !intent || expired) return Boolean(operation.rowCount);
    await client.query(
      `INSERT INTO payment_events (payment_intent_id, operation_id, amount, tx_hash, memo, matched)
       VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT (operation_id) DO NOTHING`,
      [intent.id, payment.id, amount, payment.transaction_hash, memo],
    );
    const aggregate = await client.query<{ amount: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS amount FROM payment_events WHERE payment_intent_id = $1 AND matched = TRUE`,
      [intent.id],
    );
    const received = normalizeStoredAmount(aggregate.rows[0]?.amount || "0");
    const expected = stellarAmountToStroops(intent.expected_amount);
    const nextStatus = received === expected ? "PAID" : received < expected ? "PARTIALLY_PAID" : "AMOUNT_MISMATCH";
    const receivedAmount = amountFromStroops(received);
    await client.query(
      `UPDATE payment_intents SET received_amount = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [intent.id, receivedAmount, nextStatus],
    );
    await client.query(
      `UPDATE invoices SET status = $2, paid_at = CASE WHEN $2 = 'PAID' THEN COALESCE(paid_at, NOW()) ELSE paid_at END, updated_at = NOW()
       WHERE id = $1`,
      [intent.invoice_id, nextStatus],
    );
    await client.query(
      `INSERT INTO audit_events (user_id, actor_type, type, message, metadata)
       VALUES ($1, 'SYSTEM', 'PAYMENT_DETECTED', $2, $3::jsonb)`,
      [
        intent.user_id,
        nextStatus === "PAID" ? "A Stellar Mainnet USDC payment completed this invoice." : "A Stellar Mainnet USDC payment was reconciled against this invoice.",
        JSON.stringify({
          invoiceId: intent.invoice_id,
          paymentIntentId: intent.id,
          operationId: payment.id,
          transactionHash: payment.transaction_hash,
          amount,
          status: nextStatus,
        }),
      ],
    );
    return true;
  });
}

function normalizeStoredAmount(value: string) {
  const raw = String(value || "0").trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) throw new Error("Stored payment amount is invalid.");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * STROOPS + BigInt(fraction.padEnd(7, "0"));
}

async function withTimeout<T>(work: Promise<T>, milliseconds: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function reconcileWalletPayments(wallet: WalletRecord) {
  const lock = await getPool().connect();
  try {
    const locked = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [`rupi:stellar:${wallet.id}`]);
    if (!locked.rows[0]?.locked) return { processed: 0, skipped: true };
    const cursorResult = await lock.query<{ horizon_cursor: string | null }>(
      `SELECT horizon_cursor FROM stellar_reconciliation_cursors WHERE wallet_id = $1`,
      [wallet.id],
    );
    const cursor = cursorResult.rows[0]?.horizon_cursor || "0";
    const server = getHorizonServer();
    const records = (await withTimeout(
      server.payments().forAccount(wallet.public_key).cursor(cursor).order("asc").limit(100).call(),
      12_000,
      "Horizon reconciliation timed out.",
    )).records as unknown as HorizonPayment[];
    let lastCursor = cursor;
    let processed = 0;
    for (const payment of records) {
      const memo = payment.type === "payment"
        ? await withTimeout(getTransactionMemo(payment.transaction_hash), 8_000, "Horizon memo lookup timed out.")
        : null;
      if (await persistOperation({ wallet, payment, memo })) processed += 1;
      if (payment.paging_token) lastCursor = payment.paging_token;
    }
    if (lastCursor !== cursor) {
      await getPool().query(
        `INSERT INTO stellar_reconciliation_cursors (wallet_id, horizon_cursor, last_ledger_closed_at, last_error)
         VALUES ($1, $2, NOW(), NULL)
         ON CONFLICT (wallet_id) DO UPDATE SET horizon_cursor = EXCLUDED.horizon_cursor, last_ledger_closed_at = NOW(), last_error = NULL, updated_at = NOW()`,
        [wallet.id, lastCursor],
      );
    }
    return { processed, skipped: false };
  } catch (error) {
    await getPool().query(
      `INSERT INTO stellar_reconciliation_cursors (wallet_id, last_error)
       VALUES ($1, $2)
       ON CONFLICT (wallet_id) DO UPDATE SET last_error = EXCLUDED.last_error, updated_at = NOW()`,
      [wallet.id, error instanceof Error ? error.message.slice(0, 300) : "Reconciliation failed."],
    ).catch(() => undefined);
    captureException(error, "STELLAR_RECONCILIATION_FAILED", { walletId: wallet.id });
    throw error;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`rupi:stellar:${wallet.id}`]).catch(() => undefined);
    lock.release();
  }
}

export async function reconcilePendingPayments(limit = 25) {
  await expireInvoices();
  const wallets = await getPool().query<WalletRecord>(
    `${walletSelectForReconciliation()}
     WHERE EXISTS (
       SELECT 1 FROM payment_intents pi
       WHERE pi.wallet_id = stellar_wallets.id AND pi.status IN ('AWAITING_PAYMENT', 'VIEWED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'AMOUNT_MISMATCH')
         AND pi.expires_at > NOW()
     ) ORDER BY stellar_wallets.created_at ASC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  const results: Array<{ walletId: string; processed: number; status: string }> = [];
  for (const wallet of wallets.rows) {
    try {
      const result = await reconcileWalletPayments(wallet);
      results.push({ walletId: wallet.id, processed: result.processed, status: result.skipped ? "LOCKED" : "OK" });
    } catch {
      results.push({ walletId: wallet.id, processed: 0, status: "RETRY" });
    }
  }
  return results;
}

function walletSelectForReconciliation() {
  return `SELECT id, user_id, network, public_key, fireblocks_vault_account_id, fireblocks_vault_account_name,
    xlm_asset_id, usdc_asset_id, activation_state AS provision_status, policy_state,
    last_error_code AS last_error, created_at, updated_at FROM stellar_wallets`;
}
