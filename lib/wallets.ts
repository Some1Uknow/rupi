import { createHash } from "crypto";
import { getPool } from "./db";
import { fireblocks } from "./providers/fireblocks";
import { getStellarConfig } from "./stellar";
import { recordAuditEvent } from "./audit";

export type WalletRecord = {
  id: string;
  user_id: string;
  network: "STELLAR_MAINNET";
  public_key: string;
  fireblocks_vault_account_id: string;
  fireblocks_vault_account_name: string;
  xlm_asset_id: string;
  usdc_asset_id: string;
  provision_status: "CREATED" | "ASSETS_PENDING" | "TRUSTLINE_PENDING" | "RESERVE_PENDING" | "READY" | "FAILED" | "HELD";
  policy_state: "PENDING" | "ENFORCED" | "HELD" | "REJECTED";
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type WalletBalance = {
  available: string;
  xlm: string;
  assetCode: "USDC";
  assetIssuer: string;
  address: string;
};

const walletSelect = `
  SELECT id, user_id, network, public_key, fireblocks_vault_account_id, fireblocks_vault_account_name,
         xlm_asset_id, usdc_asset_id, activation_state AS provision_status, policy_state,
         last_error_code AS last_error, created_at, updated_at
  FROM stellar_wallets`;

function vaultName(userId: string) {
  // A stable opaque ID prevents account email/name from leaking into custody UIs.
  return `rupi-user-${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
}

function reserveAmount() {
  const configured = process.env.FIREBLOCKS_USER_XLM_RESERVE?.trim() || "2";
  if (!/^\d+(?:\.\d{1,7})?$/.test(configured) || Number(configured) <= 0 || Number(configured) > 5) {
    throw new Error("FIREBLOCKS_USER_XLM_RESERVE must be a positive amount no greater than 5 XLM.");
  }
  return configured;
}

function policyState() {
  if (process.env.FIREBLOCKS_POLICY_STATE !== "enforced") {
    throw new Error("Fireblocks policy verification is incomplete. Wallet creation is paused.");
  }
  return "ENFORCED" as const;
}

async function assertSigningEnabled() {
  const result = await getPool().query<{ is_paused: boolean; reason: string | null }>(
    "SELECT is_paused, reason FROM operator_controls WHERE control_key = 'SIGNING'",
  );
  if (result.rows[0]?.is_paused) {
    throw new Error(result.rows[0].reason || "Custody signing is temporarily paused.");
  }
}

export async function getWallet(userId: string) {
  const result = await getPool().query<WalletRecord>(`${walletSelect} WHERE user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

async function updateWalletState(walletId: string, state: WalletRecord["provision_status"], error: string | null = null) {
  await getPool().query(
    `UPDATE stellar_wallets
     SET activation_state = $2, last_error_code = $3, last_error_at = CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END, updated_at = NOW()
     WHERE id = $1`,
    [walletId, state, error],
  );
}

async function withWalletLock<T>(userId: string, work: () => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`rupi:wallet:${userId}`]);
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`rupi:wallet:${userId}`]).catch(() => undefined);
    client.release();
  }
}

export async function ensureWalletForUser({ userId }: { userId: string; displayName?: string | null }) {
  return withWalletLock(userId, async () => {
    const existing = await getWallet(userId);
    if (existing) return existing;
    await assertSigningEnabled();
    const enforcedPolicyState = policyState();
    const name = vaultName(userId);
    const vault = await fireblocks.createVaultAccount(name);
    let wallet: WalletRecord | null = null;
    try {
      const [xlm, usdc] = await Promise.all([
        fireblocks.activateAsset(vault.id, fireblocks.xlmAssetId()),
        fireblocks.activateAsset(vault.id, fireblocks.usdcAssetId()),
      ]);
      if (xlm.address !== usdc.address) throw new Error("Fireblocks asset activation returned inconsistent Stellar addresses.");
      const inserted = await getPool().query<WalletRecord>(
        `INSERT INTO stellar_wallets (
           user_id, network, public_key, fireblocks_vault_account_id, fireblocks_vault_account_name,
           xlm_asset_id, usdc_asset_id, activation_state, policy_state
         ) VALUES ($1, 'STELLAR_MAINNET', $2, $3, $4, $5, $6, 'RESERVE_PENDING', $7)
         RETURNING id, user_id, network, public_key, fireblocks_vault_account_id, fireblocks_vault_account_name,
                   xlm_asset_id, usdc_asset_id, activation_state AS provision_status, policy_state,
                   last_error_code AS last_error, created_at, updated_at`,
        [userId, usdc.address, vault.id, vault.name, xlm.id, usdc.id, enforcedPolicyState],
      );
      wallet = inserted.rows[0] ?? null;
      if (!wallet) throw new Error("Could not persist the Fireblocks wallet mapping.");
      const treasuryVault = process.env.FIREBLOCKS_TREASURY_VAULT_ID?.trim();
      if (!treasuryVault) throw new Error("FIREBLOCKS_TREASURY_VAULT_ID is not configured.");
      const reserve = await fireblocks.createVaultAssetTransfer({
        sourceVaultAccountId: treasuryVault,
        destinationVaultAccountId: vault.id,
        assetId: xlm.id,
        amount: reserveAmount(),
        externalTxId: `rupi-wallet-reserve-${wallet.id}`,
      });
      await getPool().query(
        `INSERT INTO custody_transactions (user_id, wallet_id, fireblocks_transaction_id, transaction_kind, asset_id, amount, destination_address, state)
         VALUES ($1, $2, $3, 'WALLET_RESERVE', $4, $5, $6, $7)`,
        [userId, wallet.id, reserve.id, xlm.id, reserveAmount(), usdc.address, reserve.status],
      );
      await recordAuditEvent({
        userId,
        actorType: "SYSTEM",
        type: "FIREBLOCKS_WALLET_CREATED",
        message: "A Fireblocks Stellar Mainnet vault was created and funded with a capped XLM reserve.",
        metadata: { vaultAccountId: vault.id, reserveTransactionId: reserve.id },
      });
      return wallet;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 240) : "Fireblocks wallet provisioning failed.";
      if (wallet) await updateWalletState(wallet.id, "FAILED", message).catch(() => undefined);
      // The vault itself remains at Fireblocks for operator review; no signing material is present in Rupi.
      await recordAuditEvent({
        userId,
        actorType: "SYSTEM",
        type: "FIREBLOCKS_WALLET_PROVISIONING_FAILED",
        message: "Fireblocks wallet provisioning requires operator review.",
        metadata: { vaultAccountId: vault.id },
      }).catch(() => undefined);
      throw new Error(message);
    }
  });
}

export async function refreshWalletActivation(userId: string) {
  const wallet = await getWallet(userId);
  if (!wallet || wallet.provision_status === "READY") return wallet;
  const reserve = await getPool().query<{ fireblocks_transaction_id: string; state: string }>(
    `SELECT fireblocks_transaction_id, state FROM custody_transactions
     WHERE wallet_id = $1 AND transaction_kind = 'WALLET_RESERVE'
     ORDER BY created_at DESC LIMIT 1`,
    [wallet.id],
  );
  const row = reserve.rows[0];
  if (!row) return wallet;
  const transaction = await fireblocks.getTransaction(row.fireblocks_transaction_id);
  await getPool().query(
    `UPDATE custody_transactions SET state = $2, updated_at = NOW() WHERE fireblocks_transaction_id = $1`,
    [transaction.id, transaction.status],
  );
  if (["COMPLETED", "CONFIRMED"].includes(transaction.status)) {
    await updateWalletState(wallet.id, "READY");
  } else if (["FAILED", "REJECTED", "CANCELLED", "BLOCKED"].includes(transaction.status)) {
    await updateWalletState(wallet.id, "FAILED", `Fireblocks reserve transaction ${transaction.status}.`);
  }
  return getWallet(userId);
}

export async function getWalletBalance(userId: string): Promise<WalletBalance | null> {
  const wallet = await refreshWalletActivation(userId);
  if (!wallet || wallet.provision_status !== "READY") return null;
  const [usdc, xlm] = await Promise.all([
    fireblocks.getAsset(wallet.fireblocks_vault_account_id, wallet.usdc_asset_id),
    fireblocks.getAsset(wallet.fireblocks_vault_account_id, wallet.xlm_asset_id),
  ]);
  const config = getStellarConfig();
  return {
    available: usdc.balance || "0.0000000",
    xlm: xlm.balance || "0.0000000",
    assetCode: "USDC",
    assetIssuer: config.assetIssuer,
    address: wallet.public_key,
  };
}
