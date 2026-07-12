import { createHash, createSign, randomUUID } from "crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { getRequiredServerUrl } from "../env";
import { verifyHmacWebhook } from "./webhook";
import { logEvent } from "../observability";

export type FireblocksVault = {
  id: string;
  name: string;
};

export type FireblocksAsset = {
  id: string;
  address: string;
  status: string;
  balance?: string;
};

export type FireblocksTransaction = {
  id: string;
  status: string;
  txHash?: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function metricPath(path: string) {
  return path.split("?")[0].replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:id");
}

function fireblocksJwt(path: string, body: string) {
  const apiKey = required("FIREBLOCKS_API_KEY");
  const privateKey = required("FIREBLOCKS_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: apiKey }));
  const payload = base64url(JSON.stringify({
    uri: path,
    nonce: randomUUID(),
    iat: now,
    exp: now + 55,
    sub: apiKey,
    bodyHash: createHash("sha256").update(body).digest("hex"),
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

async function request<T>(method: "GET" | "POST", path: string, payload?: Record<string, unknown>): Promise<T> {
  const base = getRequiredServerUrl("FIREBLOCKS_API_BASE_URL");
  const body = payload ? JSON.stringify(payload) : "";
  const startedAt = Date.now();
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Authorization: `Bearer ${fireblocksJwt(path, body)}`,
      "X-API-Key": required("FIREBLOCKS_API_KEY"),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  logEvent(response.ok ? "info" : "warn", "FIREBLOCKS_REQUEST", { method, path: metricPath(path), status: response.status, latencyMs: Date.now() - startedAt });
  if (!response.ok) {
    throw new Error(`Fireblocks request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function xlmAssetId() {
  return required("FIREBLOCKS_STELLAR_XLM_ASSET_ID");
}

function usdcAssetId() {
  return required("FIREBLOCKS_STELLAR_USDC_ASSET_ID");
}

function addressFromAsset(asset: Record<string, unknown>) {
  const address = String(asset.address || asset.depositAddress || "");
  if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("Fireblocks returned an invalid Stellar Mainnet address.");
  return address;
}

/** Fireblocks API adapter. All user signing remains provider-side. */
export const fireblocks = {
  async createVaultAccount(name: string): Promise<FireblocksVault> {
    const payload = await request<{ id?: string; name?: string }>("POST", "/v1/vault/accounts", {
      name,
      hiddenOnUI: false,
      autoFuel: false,
    });
    if (!payload.id) throw new Error("Fireblocks did not return a vault account ID.");
    return { id: payload.id, name: payload.name || name };
  },

  async activateAsset(vaultAccountId: string, assetId: string): Promise<FireblocksAsset> {
    const payload = await request<Record<string, unknown>>("POST", `/v1/vault/accounts/${encodeURIComponent(vaultAccountId)}/${encodeURIComponent(assetId)}`, {});
    return { id: assetId, address: addressFromAsset(payload), status: String(payload.status || "PENDING"), balance: typeof payload.available === "string" ? payload.available : typeof payload.balance === "string" ? payload.balance : undefined };
  },

  async getAsset(vaultAccountId: string, assetId: string): Promise<FireblocksAsset> {
    const payload = await request<Record<string, unknown>>("GET", `/v1/vault/accounts/${encodeURIComponent(vaultAccountId)}/${encodeURIComponent(assetId)}`);
    return { id: assetId, address: addressFromAsset(payload), status: String(payload.status || "UNKNOWN"), balance: typeof payload.available === "string" ? payload.available : typeof payload.balance === "string" ? payload.balance : undefined };
  },

  xlmAssetId,
  usdcAssetId,

  async createStellarUsdcTransfer({
    vaultAccountId,
    destination,
    memo,
    amount,
    externalTxId,
  }: {
    vaultAccountId: string;
    destination: string;
    memo: string;
    amount: string;
    externalTxId: string;
  }): Promise<FireblocksTransaction> {
    if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error("Onramp supplied an invalid Stellar destination.");
    if (!memo || Buffer.byteLength(memo, "utf8") > 28) throw new Error("Onramp supplied an invalid Stellar memo.");
    const payload = await request<Record<string, unknown>>("POST", "/v1/transactions", {
      assetId: usdcAssetId(),
      source: { type: "VAULT_ACCOUNT", id: vaultAccountId },
      destination: { type: "ONE_TIME_ADDRESS", oneTimeAddress: { address: destination, tag: memo } },
      amount,
      note: "Rupi verified cash-out",
      externalTxId,
      extraParameters: { stellarMemo: memo },
    });
    const id = String(payload.id || "");
    if (!id) throw new Error("Fireblocks did not return a transaction ID.");
    return { id, status: String(payload.status || "SUBMITTED"), txHash: typeof payload.txHash === "string" ? payload.txHash : undefined };
  },

  async createVaultAssetTransfer({
    sourceVaultAccountId,
    destinationVaultAccountId,
    assetId,
    amount,
    externalTxId,
  }: {
    sourceVaultAccountId: string;
    destinationVaultAccountId: string;
    assetId: string;
    amount: string;
    externalTxId: string;
  }): Promise<FireblocksTransaction> {
    const payload = await request<Record<string, unknown>>("POST", "/v1/transactions", {
      assetId,
      source: { type: "VAULT_ACCOUNT", id: sourceVaultAccountId },
      destination: { type: "VAULT_ACCOUNT", id: destinationVaultAccountId },
      amount,
      note: "Rupi capped Stellar account reserve",
      externalTxId,
    });
    const id = String(payload.id || "");
    if (!id) throw new Error("Fireblocks did not return a reserve transaction ID.");
    return { id, status: String(payload.status || "SUBMITTED"), txHash: typeof payload.txHash === "string" ? payload.txHash : undefined };
  },

  async getTransaction(transactionId: string): Promise<FireblocksTransaction> {
    const payload = await request<Record<string, unknown>>("GET", `/v1/transactions/${encodeURIComponent(transactionId)}`);
    return {
      id: String(payload.id || transactionId),
      status: String(payload.status || "UNKNOWN"),
      txHash: typeof payload.txHash === "string" ? payload.txHash : undefined,
    };
  },

  async findTransactionByExternalId(externalTxId: string): Promise<FireblocksTransaction | null> {
    const payload = await request<Record<string, unknown>>(
      "GET",
      `/v1/transactions?externalTxId=${encodeURIComponent(externalTxId)}`,
    );
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : Array.isArray(payload) ? payload : [];
    const transaction = transactions[0];
    if (!transaction || typeof transaction !== "object") return null;
    const row = transaction as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    return id ? { id, status: String(row.status || "UNKNOWN"), txHash: typeof row.txHash === "string" ? row.txHash : undefined } : null;
  },

  verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null) {
    return verifyHmacWebhook({ secret: required("FIREBLOCKS_WEBHOOK_SECRET"), rawBody, signature, timestamp });
  },
};
