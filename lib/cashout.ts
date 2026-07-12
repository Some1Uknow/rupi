import { StrKey } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { getPool, withTransaction } from "./db";
import { getAccountProfile, type AccountProfile } from "./auth";
import { consumeStepUpToken } from "./passkeys";
import { fireblocks } from "./providers/fireblocks";
import { onramp, selectStellarUsdc, type OnrampConfiguration, type OnrampOrder, type OnrampQuote } from "./providers/onramp";
import { normalizeStellarAmount } from "./stellar";
import { getWallet, type WalletRecord } from "./wallets";
import { recordAuditEvent } from "./audit";
import { captureException } from "./observability";
import {
  CASHOUT_CAP_PER_TRANSACTION_INR,
  CASHOUT_CAP_ROLLING_24H_INR,
  RUPI_FEE_BPS,
  canTransitionCashout,
  inrToPaise,
  assertCashoutQuoteBreakdown,
  type CashoutState,
} from "./cashout-policy";

export { CASHOUT_CAP_PER_TRANSACTION_INR, CASHOUT_CAP_ROLLING_24H_INR, RUPI_FEE_BPS, canTransitionCashout, rupiFeeForGrossInr, isWithinCashoutLimits } from "./cashout-policy";

const TERMINAL_STATES = new Set<CashoutState>(["PAID", "EXPIRED", "REJECTED", "AMOUNT_MISMATCH", "REFUNDED"]);
const FIREBLOCKS_ACCEPTED_STATUSES = new Set([
  "SUBMITTED",
  "QUEUED",
  "PENDING_AML_SCREENING",
  "PENDING_AUTHORIZATION",
  "PENDING_SIGNATURE",
  "PENDING_3RD_PARTY",
  "BROADCASTING",
  "CONFIRMING",
  "CONFIRMED",
  "COMPLETED",
]);
const FIREBLOCKS_FAILURE_STATUSES = new Set(["FAILED", "REJECTED", "CANCELLED", "BLOCKED"]);


export type Beneficiary = {
  id: string;
  bank_name: string;
  account_last4: string;
  status: string;
  created_at: string;
};

type StoredBeneficiary = Beneficiary & { provider_beneficiary_token: string };

export type CashoutQuote = {
  id: string;
  providerQuoteId: string;
  amount: string;
  grossInr: string;
  onrampFeeInr: string;
  gatewayFeeInr: string;
  tdsInr: string;
  rupiFeeInr: string;
  netInr: string;
  expiresAt: string;
};

export type CashoutOrder = {
  id: string;
  amount: string;
  gross_inr: string;
  net_inr: string;
  state: CashoutState;
  provider_status: string | null;
  transaction_hash: string | null;
  created_at: string;
  updated_at: string;
  recovery: string | null;
};

type StoredQuote = {
  id: string;
  user_id: string;
  provider_quote_id: string;
  configuration_hash: string;
  usdc_amount: string;
  gross_inr: string;
  onramp_fee_inr: string;
  gateway_fee_inr: string;
  tds_inr: string;
  rupi_fee_inr: string;
  net_inr: string;
  expires_at: string;
};

type StoredOrder = CashoutOrder & {
  user_id: string;
  wallet_id: string;
  beneficiary_id: string;
  quote_id: string;
  provider_order_id: string | null;
  deposit_address: string | null;
  deposit_memo: string | null;
  fireblocks_transaction_id: string | null;
  idempotency_key: string;
  hold_reason: string | null;
};

function requirePositiveInr(value: string, label: string) {
  const paise = inrToPaise(value);
  if (paise < 0n) throw new Error(`${label} cannot be negative.`);
  return paise;
}


function validateProviderQuote(quote: OnrampQuote) {
  const gross = requirePositiveInr(quote.grossInr, "Gross INR");
  const net = requirePositiveInr(quote.netInr, "Net INR");
  requirePositiveInr(quote.onrampFeeInr, "Onramp fee");
  requirePositiveInr(quote.gatewayFeeInr, "Gateway fee");
  requirePositiveInr(quote.tdsInr, "TDS");
  requirePositiveInr(quote.rupiFeeInr, "Rupi fee");
  if (gross <= 0n || net < 0n) throw new Error("Onramp quote is not settlement-safe.");
  assertCashoutQuoteBreakdown({
    grossInr: quote.grossInr,
    onrampFeeInr: quote.onrampFeeInr,
    gatewayFeeInr: quote.gatewayFeeInr,
    tdsInr: quote.tdsInr,
    rupiFeeInr: quote.rupiFeeInr,
    netInr: quote.netInr,
  });
  if (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) {
    throw new Error("Onramp returned an expired quote.");
  }
  return quote;
}

function balanceToStroops(value: string | undefined) {
  const raw = String(value || "0").trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) throw new Error("Fireblocks returned an invalid USDC balance.");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

function classifyFireblocksStatus(value: string) {
  const status = String(value || "").toUpperCase();
  if (FIREBLOCKS_ACCEPTED_STATUSES.has(status)) return "ACCEPTED" as const;
  if (FIREBLOCKS_FAILURE_STATUSES.has(status)) return "FAILED" as const;
  return "UNKNOWN" as const;
}

function asCashoutQuote(row: StoredQuote): CashoutQuote {
  return {
    id: row.id,
    providerQuoteId: row.provider_quote_id,
    amount: row.usdc_amount,
    grossInr: row.gross_inr,
    onrampFeeInr: row.onramp_fee_inr,
    gatewayFeeInr: row.gateway_fee_inr,
    tdsInr: row.tds_inr,
    rupiFeeInr: row.rupi_fee_inr,
    netInr: row.net_inr,
    expiresAt: row.expires_at,
  };
}

function recoveryInstruction(state: CashoutState, holdReason: string | null) {
  if (state === "SUBMISSION_UNKNOWN") return "Your transfer is being reconciled. Do not submit another cash-out; contact support if it remains unresolved for 30 minutes.";
  if (["HELD", "MANUAL_REVIEW"].includes(state)) return holdReason || "This cash-out needs a compliance review. Rupi support will contact you through your verified email.";
  if (state === "REFUND_PENDING") return "A refund is being coordinated with the settlement provider. Keep this order ID for support.";
  if (state === "EXPIRED") return "This quote expired before settlement. Request a new quote; no new transfer was submitted.";
  if (state === "AMOUNT_MISMATCH") return "The provider reported an amount mismatch. Do not retry; the order is under review.";
  return null;
}

function cashoutRolloutEligible(userId: string) {
  const raw = process.env.CASHOUT_ROLLOUT_PERCENTAGE?.trim() || "0";
  const percentage = Number(raw);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("CASHOUT_ROLLOUT_PERCENTAGE must be an integer from 0 to 100.");
  const bucket = createHash("sha256").update(`rupi:cashout-rollout:${userId}`).digest()[0] % 100;
  return bucket < percentage;
}

async function getControls(keys: Array<"CASHOUT" | "SIGNING">) {
  const result = await getPool().query<{ control_key: string; is_paused: boolean; reason: string | null }>(
    `SELECT control_key, is_paused, reason FROM operator_controls WHERE control_key = ANY($1::text[])`,
    [keys],
  );
  for (const control of result.rows) {
    if (control.is_paused) throw new Error(control.reason || `${control.control_key.toLowerCase()} is temporarily paused.`);
  }
}

export async function syncOnrampConfiguration() {
  const configuration = await onramp.getConfiguration();
  const selected = selectStellarUsdc(configuration);
  const hash = onramp.configurationHash(configuration);
  await getPool().query(
    `INSERT INTO onramp_configuration_snapshots (
       configuration_hash, stellar_usdc_available, memo_supported, max_inr_per_order, raw_configuration, expires_at
     ) VALUES ($1, TRUE, $2, $3, $4::jsonb, NOW() + INTERVAL '24 hours')
     ON CONFLICT (configuration_hash) DO UPDATE SET fetched_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [hash, selected.network.memoSupported, selected.network.maxAmount || null, JSON.stringify(configuration.raw)],
  );
  return { configuration, hash, networkId: selected.network.id };
}

async function currentConfiguration() {
  const result = await getPool().query<{ configuration_hash: string; raw_configuration: Record<string, unknown>; expires_at: string | null }>(
    `SELECT configuration_hash, raw_configuration, expires_at FROM onramp_configuration_snapshots
     WHERE stellar_usdc_available = TRUE AND memo_supported = TRUE
     ORDER BY fetched_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("Onramp network configuration is unavailable or stale. Cash-out is paused.");
  }
  // Re-normalize the stored provider configuration; do not hard-code a mutable coin ID.
  const configuration = normalizeStoredConfiguration(row.raw_configuration);
  const selected = selectStellarUsdc(configuration);
  return { hash: row.configuration_hash, configuration, networkId: selected.network.id };
}

function normalizeStoredConfiguration(raw: Record<string, unknown>): OnrampConfiguration {
  const coinsValue = raw.coins || raw.assets || raw.supportedCoins;
  if (!Array.isArray(coinsValue)) throw new Error("Stored Onramp configuration is invalid.");
  const coins = coinsValue.map((value) => {
    const coin = value as Record<string, unknown>;
    const networks = coin.networks || coin.networkList;
    if (!Array.isArray(networks)) throw new Error("Stored Onramp network configuration is invalid.");
    return {
      id: String(coin.id || coin.coinId || coin.coinCode || ""),
      coinCode: String(coin.coinCode || coin.code || coin.symbol || "").toLowerCase(),
      networks: networks.map((networkValue) => {
        const network = networkValue as Record<string, unknown>;
        return {
          id: String(network.id || network.networkId || network.symbol || ""),
          symbol: String(network.symbol || network.network || network.code || "").toLowerCase(),
          memoSupported: Boolean(network.memoSupported || network.supportsMemo || network.memoRequired),
          minAmount: typeof network.minAmount === "string" ? network.minAmount : undefined,
          maxAmount: typeof network.maxAmount === "string" ? network.maxAmount : undefined,
        };
      }),
    };
  });
  return { coins, raw };
}

export async function getBeneficiary(userId: string): Promise<Beneficiary | null> {
  const result = await getPool().query<Beneficiary>(
    `SELECT id, bank_name, account_last4, status, created_at
     FROM onramp_beneficiaries WHERE user_id = $1 AND status = 'ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function getActiveBeneficiary(userId: string): Promise<StoredBeneficiary | null> {
  const result = await getPool().query<StoredBeneficiary>(
    `SELECT id, provider_beneficiary_token, bank_name, account_last4, status, created_at
     FROM onramp_beneficiaries WHERE user_id = $1 AND status = 'ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function startKycSession({ userId, email, returnUrl }: { userId: string; email: string; returnUrl: string }) {
  const profile = await getAccountProfile(userId);
  if (!profile) throw new Error("Complete email verification and passkey enrollment first.");
  if (profile.account_state === "PENDING_PASSKEY") {
    throw new Error("Enroll your passkey before starting Onramp verification.");
  }
  if (profile.account_state === "SUSPENDED" || profile.account_state === "RECOVERY_REVIEW") {
    throw new Error("Your account requires a security review before starting verification.");
  }
  const session = await onramp.createKycSession({ providerCustomerId: profile.onramp_customer_id ?? undefined, email, returnUrl });
  const providerCustomerId = String(session.customerId || session.customer_id || session.id || "");
  const hostedUrl = String(session.url || session.kycUrl || session.redirectUrl || "");
  if (!providerCustomerId || !hostedUrl.startsWith("https://")) throw new Error("Onramp did not return a tokenized KYC session.");
  await getPool().query(
    `UPDATE account_profiles SET onramp_customer_id = $2, kyc_state = 'PENDING', kyc_updated_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId, providerCustomerId],
  );
  await recordAuditEvent({ userId, actorType: "USER", actorId: userId, type: "ONRAMP_KYC_SESSION_STARTED", message: "A tokenized Onramp KYC session was started." });
  return { hostedUrl };
}

export async function startBeneficiarySession({ userId, returnUrl }: { userId: string; returnUrl: string }) {
  const profile = await getAccountProfile(userId);
  if (!profile?.onramp_customer_id || profile.kyc_state !== "APPROVED") throw new Error("Complete Onramp KYC before adding a bank account.");
  const session = await onramp.createBeneficiarySession({ providerCustomerId: profile.onramp_customer_id, returnUrl });
  const hostedUrl = String(session.url || session.beneficiaryUrl || session.redirectUrl || "");
  if (!hostedUrl.startsWith("https://")) throw new Error("Onramp did not return a tokenized beneficiary session.");
  await recordAuditEvent({ userId, actorType: "USER", actorId: userId, type: "ONRAMP_BENEFICIARY_SESSION_STARTED", message: "A tokenized Onramp beneficiary session was started." });
  return { hostedUrl };
}

async function assertCashoutPrerequisites(userId: string) {
  await getControls(["CASHOUT", "SIGNING"]);
  const [profile, beneficiary, wallet, configuration] = await Promise.all([
    getAccountProfile(userId),
    getActiveBeneficiary(userId),
    getWallet(userId),
    currentConfiguration(),
  ]);
  if (!profile || profile.kyc_state !== "APPROVED") throw new Error("Complete Onramp KYC before cashing out.");
  if (profile.account_state !== "ACTIVE") throw new Error("Your account is not approved for cash-out.");
  if (!cashoutRolloutEligible(userId)) throw new Error("Cash-out is not enabled for your account yet.");
  if (!beneficiary) throw new Error("Add a bank account through the secure Onramp flow before cashing out.");
  if (!wallet || wallet.provision_status !== "READY" || wallet.policy_state !== "ENFORCED") {
    throw new Error("Your Fireblocks wallet is not ready for cash-out.");
  }
  return { profile, beneficiary, wallet, configuration };
}

async function assertRollingLimit(userId: string, grossInr: string) {
  const result = await getPool().query<{ total: string }>(
    `SELECT COALESCE(SUM(q.gross_inr), 0)::text AS total
     FROM offramp_orders o JOIN cashout_quotes q ON q.id = o.quote_id
     WHERE o.user_id = $1 AND o.created_at > NOW() - INTERVAL '24 hours'
       AND o.state NOT IN ('EXPIRED', 'REJECTED', 'REFUNDED')`,
    [userId],
  );
  const perTransaction = inrToPaise(grossInr);
  const rolling = inrToPaise(result.rows[0]?.total || "0");
  if (perTransaction > inrToPaise(CASHOUT_CAP_PER_TRANSACTION_INR)) {
    throw new Error(`Cash-outs are limited to ₹${CASHOUT_CAP_PER_TRANSACTION_INR} per transaction.`);
  }
  if (rolling + perTransaction > inrToPaise(CASHOUT_CAP_ROLLING_24H_INR)) {
    throw new Error(`Cash-outs are limited to ₹${CASHOUT_CAP_ROLLING_24H_INR} in a rolling 24-hour period.`);
  }
}

async function assertWalletBalance(wallet: WalletRecord, amount: string) {
  const asset = await fireblocks.getAsset(wallet.fireblocks_vault_account_id, wallet.usdc_asset_id);
  const available = balanceToStroops(asset.balance);
  const required = balanceToStroops(amount);
  if (available < required) {
    throw new Error("Your available Fireblocks USDC balance is insufficient for this cash-out.");
  }
}

export async function createCashoutQuote({ userId, amount }: { userId: string; amount: string }) {
  const normalizedAmount = normalizeStellarAmount(amount);
  const { profile, beneficiary, configuration } = await assertCashoutPrerequisites(userId);
  const providerQuote = validateProviderQuote(await onramp.createQuote({
    providerCustomerId: profile.onramp_customer_id!,
    beneficiaryToken: beneficiary.provider_beneficiary_token,
    amount: normalizedAmount,
    networkId: configuration.networkId,
  }));
  if (normalizeStellarAmount(providerQuote.usdcAmount) !== normalizedAmount) {
    throw new Error("Onramp quote amount does not match the requested USDC amount.");
  }
  if (providerQuote.networkId !== configuration.networkId) {
    throw new Error("Onramp quote does not match the verified Stellar USDC network configuration.");
  }
  await assertRollingLimit(userId, providerQuote.grossInr);
  const result = await getPool().query<StoredQuote>(
    `INSERT INTO cashout_quotes (
       user_id, provider_quote_id, configuration_hash, usdc_amount, gross_inr, onramp_fee_inr,
       gateway_fee_inr, tds_inr, rupi_fee_inr, net_inr, quote_payload, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
     ON CONFLICT (provider_quote_id) DO NOTHING
     RETURNING id, user_id, provider_quote_id, configuration_hash, usdc_amount::text, gross_inr::text,
               onramp_fee_inr::text, gateway_fee_inr::text, tds_inr::text, rupi_fee_inr::text, net_inr::text, expires_at`,
    [
      userId, providerQuote.id, configuration.hash, normalizedAmount, providerQuote.grossInr, providerQuote.onrampFeeInr,
      providerQuote.gatewayFeeInr, providerQuote.tdsInr, providerQuote.rupiFeeInr, providerQuote.netInr,
      JSON.stringify(providerQuote.raw), providerQuote.expiresAt,
    ],
  );
  let quote = result.rows[0];
  if (!quote) {
    const existing = await getPool().query<StoredQuote>(
      `SELECT id, user_id, provider_quote_id, configuration_hash, usdc_amount::text, gross_inr::text,
              onramp_fee_inr::text, gateway_fee_inr::text, tds_inr::text, rupi_fee_inr::text, net_inr::text, expires_at
       FROM cashout_quotes WHERE provider_quote_id = $1`,
      [providerQuote.id],
    );
    quote = existing.rows[0];
    if (quote && quote.user_id !== userId) throw new Error("Onramp returned a quote already bound to another customer.");
  }
  if (!quote) throw new Error("Could not persist the signed Onramp quote.");
  await recordAuditEvent({ userId, actorType: "USER", actorId: userId, type: "ONRAMP_QUOTE_CREATED", message: "An Onramp-signed cash-out quote was created.", metadata: { quoteId: quote.id, amount: quote.usdc_amount } });
  return asCashoutQuote(quote);
}

async function getQuoteForOrder(userId: string, quoteId: string) {
  const result = await getPool().query<StoredQuote>(
    `SELECT id, user_id, provider_quote_id, configuration_hash, usdc_amount::text, gross_inr::text,
            onramp_fee_inr::text, gateway_fee_inr::text, tds_inr::text, rupi_fee_inr::text, net_inr::text, expires_at
     FROM cashout_quotes WHERE id = $1 AND user_id = $2`,
    [quoteId, userId],
  );
  const quote = result.rows[0];
  if (!quote) throw new Error("Cash-out quote was not found.");
  if (Date.parse(quote.expires_at) <= Date.now()) throw new Error("Cash-out quote has expired. Get a new quote.");
  return quote;
}

async function withCashoutLock<T>(userId: string, work: () => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`rupi:cashout:${userId}`]);
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`rupi:cashout:${userId}`]).catch(() => undefined);
    client.release();
  }
}

async function appendOrderEvent(orderId: string, state: CashoutState, source: string, message: string, metadata: Record<string, unknown> = {}) {
  await getPool().query(
    `INSERT INTO offramp_order_events (order_id, state, source, message, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orderId, state, source, message, JSON.stringify(metadata)],
  );
}

function validateOnrampDeposit({ order, amount, networkId }: { order: OnrampOrder; amount: string; networkId: string }) {
  if (order.coinCode !== "usdc" || order.networkSymbol !== "xlm" || order.networkId !== networkId) {
    throw new Error("Onramp order does not match the verified Stellar USDC network configuration.");
  }
  if (normalizeStellarAmount(order.usdcAmount) !== normalizeStellarAmount(amount)) {
    throw new Error("Onramp order amount does not match the locked quote.");
  }
  if (!StrKey.isValidEd25519PublicKey(order.depositAddress)) throw new Error("Onramp returned an invalid Stellar Mainnet deposit address.");
  if (!order.depositMemo || Buffer.byteLength(order.depositMemo, "utf8") > 28) throw new Error("Onramp returned an invalid Stellar memo.");
  return order;
}

function publicOrder(row: StoredOrder): CashoutOrder {
  return {
    id: row.id,
    amount: row.amount,
    gross_inr: row.gross_inr,
    net_inr: row.net_inr,
    state: row.state,
    provider_status: row.provider_status,
    transaction_hash: row.transaction_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
    recovery: recoveryInstruction(row.state, row.hold_reason),
  };
}

const orderSelect = `
  SELECT o.id, q.usdc_amount::text AS amount, q.gross_inr::text, q.net_inr::text, o.state,
         o.provider_status, o.transaction_hash, o.created_at, o.updated_at, o.hold_reason,
         o.user_id, o.wallet_id, o.beneficiary_id, o.quote_id, o.provider_order_id,
         o.deposit_address, o.deposit_memo, o.fireblocks_transaction_id, o.idempotency_key
  FROM offramp_orders o JOIN cashout_quotes q ON q.id = o.quote_id`;

async function getStoredOrder(id: string) {
  const result = await getPool().query<StoredOrder>(`${orderSelect} WHERE o.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function createCashoutOrder({
  userId,
  quoteId,
  idempotencyKey,
  stepUpToken,
}: {
  userId: string;
  quoteId: string;
  idempotencyKey: string;
  stepUpToken: string;
}) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new Error("Use a valid Idempotency-Key when creating a cash-out.");
  return withCashoutLock(userId, async () => {
    const existing = await getPool().query<StoredOrder>(`${orderSelect} WHERE o.user_id = $1 AND o.idempotency_key = $2`, [userId, idempotencyKey]);
    if (existing.rows[0]) return publicOrder(existing.rows[0]);
    const quote = await getQuoteForOrder(userId, quoteId);
    const { profile, beneficiary, wallet, configuration } = await assertCashoutPrerequisites(userId);
    if (quote.configuration_hash !== configuration.hash) throw new Error("Onramp network configuration changed. Get a new quote.");
    await assertRollingLimit(userId, quote.gross_inr);
    await assertWalletBalance(wallet, quote.usdc_amount);
    await consumeStepUpToken({ userId, action: "CASHOUT", amount: quote.usdc_amount, idempotencyKey, token: stepUpToken });
    const providerOrder = validateOnrampDeposit({
      order: await onramp.createOrder({
        providerCustomerId: profile.onramp_customer_id!,
        beneficiaryToken: beneficiary.provider_beneficiary_token,
        providerQuoteId: quote.provider_quote_id,
        idempotencyKey,
      }),
      amount: quote.usdc_amount,
      networkId: configuration.networkId,
    });
    // Persist all provider-provided transfer instructions before the signing call.
    const inserted = await getPool().query<{ id: string }>(
      `INSERT INTO offramp_orders (
         user_id, wallet_id, beneficiary_id, quote_id, provider_order_id, state, deposit_address, deposit_memo,
         provider_status, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, 'ORDER_CREATED', $6, $7, $8, $9) RETURNING id`,
      [userId, wallet.id, beneficiary.id, quote.id, providerOrder.id, providerOrder.depositAddress, providerOrder.depositMemo, providerOrder.status, idempotencyKey],
    );
    const orderId = inserted.rows[0]?.id;
    if (!orderId) throw new Error("Could not persist the Onramp order before signing.");
    await appendOrderEvent(orderId, "ORDER_CREATED", "ONRAMP", "Onramp order created with validated Stellar deposit instructions.", { providerOrderId: providerOrder.id });
    await getPool().query("UPDATE offramp_orders SET state = 'SIGNING', submission_attempted_at = NOW(), updated_at = NOW() WHERE id = $1", [orderId]);
    await appendOrderEvent(orderId, "SIGNING", "RUPI", "Fireblocks signing request initiated.");
    let persistedFireblocksSubmission = false;
    try {
      const transaction = await fireblocks.createStellarUsdcTransfer({
        vaultAccountId: wallet.fireblocks_vault_account_id,
        destination: providerOrder.depositAddress,
        memo: providerOrder.depositMemo,
        amount: quote.usdc_amount,
        externalTxId: `rupi-cashout-${orderId}`,
      });
      const outcome = classifyFireblocksStatus(transaction.status);
      const nextState: CashoutState = outcome === "ACCEPTED"
        ? "SUBMITTED"
        : outcome === "FAILED"
          ? "MANUAL_REVIEW"
          : "SUBMISSION_UNKNOWN";
      const holdReason = outcome === "ACCEPTED" ? null : `Fireblocks status: ${transaction.status}`;
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE offramp_orders
           SET state = $2, fireblocks_transaction_id = $3, transaction_hash = $4, hold_reason = $5, updated_at = NOW()
           WHERE id = $1`,
          [orderId, nextState, transaction.id, transaction.txHash || null, holdReason],
        );
        await client.query(
          `INSERT INTO custody_transactions (
            user_id, wallet_id, offramp_order_id, fireblocks_transaction_id, transaction_kind, asset_id, amount,
            destination_address, destination_memo, state
          ) VALUES ($1, $2, $3, $4, 'CASHOUT', $5, $6, $7, $8, $9)`,
          [userId, wallet.id, orderId, transaction.id, wallet.usdc_asset_id, quote.usdc_amount, providerOrder.depositAddress, providerOrder.depositMemo, transaction.status],
        );
      });
      persistedFireblocksSubmission = true;
      if (outcome === "ACCEPTED") {
        await appendOrderEvent(orderId, "SUBMITTED", "FIREBLOCKS", "Fireblocks accepted the exact USDC transfer.", { transactionId: transaction.id });
        await recordAuditEvent({ userId, actorType: "USER", actorId: userId, type: "CASHOUT_SUBMITTED", message: "A passkey-authorized Fireblocks cash-out transfer was submitted.", metadata: { orderId, transactionId: transaction.id } });
      } else {
        await appendOrderEvent(
          orderId,
          nextState,
          "FIREBLOCKS",
          outcome === "FAILED"
            ? "Fireblocks rejected the transfer; the order requires manual review."
            : "Fireblocks returned an indeterminate transfer status; the order requires reconciliation.",
          { transactionId: transaction.id, status: transaction.status },
        );
        await recordAuditEvent({ userId, actorType: "SYSTEM", type: "CASHOUT_REQUIRES_REVIEW", message: "A cash-out did not receive a confirmed Fireblocks submission result.", metadata: { orderId, transactionId: transaction.id } });
      }
    } catch (error) {
      if (persistedFireblocksSubmission) {
        captureException(error, "CASHOUT_POST_SUBMISSION_AUDIT_FAILED", { orderId });
        const stored = await getStoredOrder(orderId);
        if (stored) return publicOrder(stored);
        throw error;
      }
      // A timeout or an ambiguous provider failure must never cause an automatic re-send.
      const message = error instanceof Error ? error.message.slice(0, 280) : "Fireblocks submission outcome is unknown.";
      await getPool().query(
        `UPDATE offramp_orders SET state = 'SUBMISSION_UNKNOWN', hold_reason = $2, updated_at = NOW() WHERE id = $1`,
        [orderId, message],
      );
      await appendOrderEvent(orderId, "SUBMISSION_UNKNOWN", "FIREBLOCKS", "Fireblocks submission outcome requires reconciliation.", { reason: message });
      await recordAuditEvent({ userId, actorType: "SYSTEM", type: "CASHOUT_SUBMISSION_UNKNOWN", message: "A cash-out submission was held for reconciliation.", metadata: { orderId } });
      captureException(error, "FIREBLOCKS_CASHOUT_SUBMISSION_UNKNOWN", { orderId });
    }
    const stored = await getStoredOrder(orderId);
    if (!stored) throw new Error("Cash-out order could not be loaded.");
    return publicOrder(stored);
  });
}

export async function listCashoutOrders(userId: string) {
  const result = await getPool().query<StoredOrder>(`${orderSelect} WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [userId]);
  return result.rows.map(publicOrder);
}

export async function getCashoutOrder(orderId: string, userId: string) {
  const result = await getPool().query<StoredOrder>(`${orderSelect} WHERE o.id = $1 AND o.user_id = $2`, [orderId, userId]);
  return result.rows[0] ? publicOrder(result.rows[0]) : null;
}

export async function getCashoutConfig(userId: string) {
  const [profile, beneficiary, latest] = await Promise.all([
    getAccountProfile(userId),
    getBeneficiary(userId),
    getPool().query<{ expires_at: string | null }>(
      "SELECT expires_at FROM onramp_configuration_snapshots WHERE stellar_usdc_available = TRUE AND memo_supported = TRUE ORDER BY fetched_at DESC LIMIT 1",
    ),
  ]);
  const providerAvailable = Boolean(latest.rows[0]?.expires_at && Date.parse(latest.rows[0].expires_at) > Date.now());
  let paused = false;
  try { await getControls(["CASHOUT", "SIGNING"]); } catch { paused = true; }
  const kycState = profile?.kyc_state || "NOT_STARTED";
  return {
    available: Boolean(profile && profile.account_state === "ACTIVE" && profile.kyc_state === "APPROVED" && cashoutRolloutEligible(userId) && beneficiary && providerAvailable && !paused),
    kycState,
    providerAvailable,
    beneficiary: beneficiary ? { bankName: beneficiary.bank_name, accountLast4: beneficiary.account_last4 } : null,
    caps: { perTransactionInr: CASHOUT_CAP_PER_TRANSACTION_INR, rolling24hInr: CASHOUT_CAP_ROLLING_24H_INR, rupiFeeBps: RUPI_FEE_BPS },
  };
}

function providerStatusToState(value: string): CashoutState | null {
  const normalized = value.replace(/[\s-]+/g, "_").toUpperCase();
  const mappings: Record<string, CashoutState> = {
    ORDER_CREATED: "ORDER_CREATED",
    AWAITING_DEPOSIT: "SUBMITTED",
    DEPOSIT_FOUND: "DEPOSIT_FOUND",
    SELLING: "SELLING",
    PAYOUT_INITIATED: "PAYOUT_INITIATED",
    PAID: "PAID",
    COMPLETED: "PAID",
    EXPIRED: "EXPIRED",
    REJECTED: "REJECTED",
    AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
    HELD: "HELD",
    MANUAL_REVIEW: "MANUAL_REVIEW",
    REFUND_PENDING: "REFUND_PENDING",
    REFUNDED: "REFUNDED",
  };
  return mappings[normalized] || null;
}

async function transitionFromProvider({ orderId, source, providerStatus, payload }: { orderId: string; source: "ONRAMP" | "FIREBLOCKS"; providerStatus: string; payload: Record<string, unknown> }) {
  const order = await getStoredOrder(orderId);
  if (!order || TERMINAL_STATES.has(order.state)) return;
  const next = source === "ONRAMP" ? providerStatusToState(providerStatus) : null;
  if (!next) return;
  if (!canTransitionCashout(order.state, next)) {
    await appendOrderEvent(orderId, order.state, source, "Ignored out-of-order provider state.", { providerStatus, ignoredState: next });
    return;
  }
  const holdReason = next === "HELD" || next === "MANUAL_REVIEW" ? `Onramp status: ${providerStatus}` : null;
  await getPool().query(
    `UPDATE offramp_orders SET state = $2, provider_status = $3, hold_reason = COALESCE($4, hold_reason), updated_at = NOW() WHERE id = $1`,
    [orderId, next, providerStatus, holdReason],
  );
  await appendOrderEvent(orderId, next, source, `Provider reported ${providerStatus}.`, { providerStatus });
  if (next === "PAID") {
    await recordAuditEvent({ userId: order.user_id, actorType: "PROVIDER", actorId: "onramp", type: "CASHOUT_PAID", message: "Onramp verified that INR payout completed.", metadata: { orderId } });
  }
}

function providerObject(payload: Record<string, unknown>) {
  const data = payload.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : payload;
}

export async function processOnrampWebhook(payload: Record<string, unknown>) {
  const data = providerObject(payload);
  const providerOrderId = String(data.orderId || data.order_id || data.id || "");
  const status = String(data.status || data.orderStatus || "");
  const customerId = String(data.customerId || data.customer_id || "");
  const kycStatus = String(data.kycStatus || data.kyc_status || "").toUpperCase();
  if (customerId && kycStatus) {
    const mapped = ["APPROVED", "REJECTED", "PENDING", "EXPIRED", "REVIEW"].includes(kycStatus) ? kycStatus : "REVIEW";
    await getPool().query(
      `UPDATE account_profiles
       SET kyc_state = $2, account_state = CASE WHEN $2 = 'APPROVED' AND account_state = 'PENDING_KYC' THEN 'ACTIVE' ELSE account_state END,
           kyc_updated_at = NOW(), updated_at = NOW() WHERE onramp_customer_id = $1`,
      [customerId, mapped],
    );
  }
  const beneficiaryToken = String(data.beneficiaryToken || data.beneficiary_token || "");
  if (customerId && beneficiaryToken) {
    const bankName = String(data.bankName || data.bank_name || "").trim();
    const last4 = String(data.accountLast4 || data.account_last4 || "").replace(/\D/g, "");
    if (bankName && /^\d{4}$/.test(last4)) {
      const beneficiaryUserId = await withTransaction(async (client) => {
        const owner = await client.query<{ user_id: string }>(
          `SELECT user_id FROM account_profiles WHERE onramp_customer_id = $1 FOR UPDATE`,
          [customerId],
        );
        const userId = owner.rows[0]?.user_id;
        if (!userId) return null;
        // A user can have one active payout bank at a time. Deactivate a prior
        // provider token before activating a new one so the partial unique
        // index cannot strand the customer during a bank-account change.
        await client.query(
          `UPDATE onramp_beneficiaries SET status = 'REPLACED', updated_at = NOW()
           WHERE user_id = $1 AND status = 'ACTIVE' AND provider_beneficiary_token <> $2`,
          [userId, beneficiaryToken],
        );
        await client.query(
          `INSERT INTO onramp_beneficiaries (user_id, provider_beneficiary_token, bank_name, account_last4, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')
           ON CONFLICT (provider_beneficiary_token) DO UPDATE SET
             bank_name = EXCLUDED.bank_name,
             account_last4 = EXCLUDED.account_last4,
             status = 'ACTIVE',
             updated_at = NOW()`,
          [userId, beneficiaryToken, bankName.slice(0, 120), last4],
        );
        return userId;
      });
      if (beneficiaryUserId) {
        await recordAuditEvent({
          userId: beneficiaryUserId,
          actorType: "PROVIDER",
          actorId: "onramp",
          type: "ONRAMP_BENEFICIARY_UPDATED",
          message: "Onramp updated the tokenized payout bank reference.",
        });
      }
    }
  }
  if (!providerOrderId || !status) return;
  const order = await getPool().query<{ id: string }>("SELECT id FROM offramp_orders WHERE provider_order_id = $1", [providerOrderId]);
  if (order.rows[0]) await transitionFromProvider({ orderId: order.rows[0].id, source: "ONRAMP", providerStatus: status, payload: data });
}

export async function processFireblocksWebhook(payload: Record<string, unknown>) {
  const data = providerObject(payload);
  const transactionId = String(data.id || data.transactionId || data.txId || "");
  const status = String(data.status || "").toUpperCase();
  if (!transactionId || !status) return;
  const custody = await getPool().query<{ offramp_order_id: string | null }>(
    `UPDATE custody_transactions SET state = $2, raw_payload = $3::jsonb, updated_at = NOW()
     WHERE fireblocks_transaction_id = $1 RETURNING offramp_order_id`,
    [transactionId, status, JSON.stringify(data)],
  );
  const orderId = custody.rows[0]?.offramp_order_id;
  if (!orderId) return;
  const txHash = typeof data.txHash === "string" ? data.txHash : typeof data.tx_hash === "string" ? data.tx_hash : null;
  if (["COMPLETED", "CONFIRMED"].includes(status)) {
    const updated = await getPool().query(
      `UPDATE offramp_orders SET state = CASE WHEN state = 'SUBMISSION_UNKNOWN' THEN 'SUBMITTED' ELSE state END,
       transaction_hash = COALESCE($2, transaction_hash), updated_at = NOW()
       WHERE id = $1 AND state NOT IN ('PAID', 'EXPIRED', 'REJECTED', 'AMOUNT_MISMATCH', 'REFUNDED') RETURNING id`,
      [orderId, txHash],
    );
    if (!updated.rowCount) return;
    await appendOrderEvent(orderId, "SUBMITTED", "FIREBLOCKS", "Fireblocks confirmed the transfer; awaiting verified Onramp deposit status.", { transactionId });
  } else if (["FAILED", "REJECTED", "CANCELLED", "BLOCKED"].includes(status)) {
    const updated = await getPool().query(
      `UPDATE offramp_orders SET state = 'MANUAL_REVIEW', hold_reason = $2, updated_at = NOW()
       WHERE id = $1 AND state NOT IN ('PAID', 'EXPIRED', 'REJECTED', 'AMOUNT_MISMATCH', 'REFUNDED') RETURNING id`,
      [orderId, `Fireblocks status: ${status}`],
    );
    if (!updated.rowCount) return;
    await appendOrderEvent(orderId, "MANUAL_REVIEW", "FIREBLOCKS", "Fireblocks did not confirm a safe transfer outcome.", { transactionId, status });
  }
}

export async function pollOnrampOrder(orderId: string) {
  const order = await getStoredOrder(orderId);
  if (!order || !order.provider_order_id || TERMINAL_STATES.has(order.state)) return;
  const response = await onramp.getOrderStatus(order.provider_order_id);
  const data = providerObject(response);
  const status = String(data.status || data.orderStatus || "");
  if (status) await transitionFromProvider({ orderId, source: "ONRAMP", providerStatus: status, payload: data });
}

/** Poll Fireblocks as a webhook fallback before relying on settlement status. */
export async function pollFireblocksOrder(orderId: string) {
  const order = await getStoredOrder(orderId);
  if (!order || !order.fireblocks_transaction_id || TERMINAL_STATES.has(order.state)) return;
  const transaction = await fireblocks.getTransaction(order.fireblocks_transaction_id);
  await processFireblocksWebhook({
    data: {
      id: transaction.id,
      status: transaction.status,
      ...(transaction.txHash ? { txHash: transaction.txHash } : {}),
    },
  });
}

export async function reconcileUnknownSubmission(orderId: string) {
  const order = await getStoredOrder(orderId);
  if (!order || order.state !== "SUBMISSION_UNKNOWN") return;
  const transaction = await fireblocks.findTransactionByExternalId(`rupi-cashout-${order.id}`);
  if (!transaction) return;
  const outcome = classifyFireblocksStatus(transaction.status);
  if (outcome === "UNKNOWN") return;
  const nextState: CashoutState = outcome === "ACCEPTED" ? "SUBMITTED" : "MANUAL_REVIEW";
  const holdReason = outcome === "ACCEPTED" ? null : `Fireblocks status: ${transaction.status}`;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE offramp_orders
       SET state = $2, fireblocks_transaction_id = $3, transaction_hash = COALESCE($4, transaction_hash), hold_reason = $5, updated_at = NOW()
       WHERE id = $1 AND state = 'SUBMISSION_UNKNOWN'`,
      [order.id, nextState, transaction.id, transaction.txHash || null, holdReason],
    );
    await client.query(
      `INSERT INTO custody_transactions (
        user_id, wallet_id, offramp_order_id, fireblocks_transaction_id, transaction_kind, asset_id, amount,
        destination_address, destination_memo, state
      ) SELECT o.user_id, o.wallet_id, o.id, $2, 'CASHOUT', w.usdc_asset_id, q.usdc_amount,
               o.deposit_address, o.deposit_memo, $3
        FROM offramp_orders o JOIN stellar_wallets w ON w.id = o.wallet_id JOIN cashout_quotes q ON q.id = o.quote_id
        WHERE o.id = $1
        ON CONFLICT (fireblocks_transaction_id) DO NOTHING`,
      [order.id, transaction.id, transaction.status],
    );
  });
  await appendOrderEvent(
    order.id,
    nextState,
    "FIREBLOCKS",
    outcome === "ACCEPTED"
      ? "Reconciliation found the Fireblocks transaction without retrying a send."
      : "Reconciliation found a failed Fireblocks transaction; the order requires manual review.",
    { transactionId: transaction.id, status: transaction.status },
  );
}

export async function reconcileProviderOrders(limit = 50) {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM offramp_orders
     WHERE state NOT IN ('PAID', 'EXPIRED', 'REJECTED', 'AMOUNT_MISMATCH', 'REFUNDED')
     ORDER BY updated_at ASC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  const outcomes: Array<{ id: string; status: string }> = [];
  for (const row of result.rows) {
    try { await reconcileUnknownSubmission(row.id); await pollFireblocksOrder(row.id); await pollOnrampOrder(row.id); outcomes.push({ id: row.id, status: "OK" }); }
    catch { outcomes.push({ id: row.id, status: "RETRY" }); }
  }
  return outcomes;
}

/** Poll KYC as a webhook fallback; a failed webhook must not strand onboarding. */
export async function reconcilePendingKycStatuses(limit = 50) {
  const profiles = await getPool().query<{ onramp_customer_id: string }>(
    `SELECT onramp_customer_id FROM account_profiles
     WHERE onramp_customer_id IS NOT NULL AND kyc_state IN ('PENDING', 'REVIEW')
     ORDER BY kyc_updated_at ASC NULLS FIRST LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  const outcomes: Array<{ customerId: string; status: string }> = [];
  for (const profile of profiles.rows) {
    try {
      const response = await onramp.getKycStatus(profile.onramp_customer_id);
      const data = providerObject(response);
      const status = String(data.kycStatus || data.kyc_status || data.status || "").toUpperCase();
      if (!status) throw new Error("Onramp KYC status response was empty.");
      await processOnrampWebhook({
        data: {
          ...data,
          customerId: data.customerId || data.customer_id || profile.onramp_customer_id,
          kycStatus: status,
        },
      });
      outcomes.push({ customerId: profile.onramp_customer_id, status: "OK" });
    } catch {
      outcomes.push({ customerId: profile.onramp_customer_id, status: "RETRY" });
    }
  }
  return outcomes;
}

export async function requestCashoutRefund({ orderId, reason, operatorId }: { orderId: string; reason: string; operatorId: string }) {
  const order = await getStoredOrder(orderId);
  if (!order || !order.provider_order_id) throw new Error("Cash-out order was not found or is not refundable.");
  if (TERMINAL_STATES.has(order.state)) throw new Error("This cash-out order is already terminal.");
  const response = await onramp.cancelOrRefund(order.provider_order_id, reason.slice(0, 500));
  const reference = String(response.refundId || response.id || "");
  await getPool().query(
    `UPDATE offramp_orders SET state = 'REFUND_PENDING', refund_reference = $2, updated_at = NOW() WHERE id = $1`,
    [orderId, reference || null],
  );
  await appendOrderEvent(orderId, "REFUND_PENDING", "OPERATOR", "Operator requested provider refund.", { operatorId, refundReference: reference || undefined });
  await recordAuditEvent({ userId: order.user_id, actorType: "OPERATOR", actorId: operatorId, type: "CASHOUT_REFUND_REQUESTED", message: "An operator requested an Onramp refund.", metadata: { orderId } });
}
