import { Asset, Horizon, Memo, Networks, StrKey } from "@stellar/stellar-sdk";

export type StellarConfig = {
  network: "MAINNET";
  networkLabel: "Stellar Mainnet";
  networkPassphrase: string;
  horizonUrl: string;
  assetCode: "USDC";
  assetIssuer: string;
  explorerBaseUrl: string;
};

export function getStellarConfig(): StellarConfig {
  if (process.env.STELLAR_NETWORK !== "mainnet") {
    throw new Error("Rupi only serves Stellar Mainnet. Set STELLAR_NETWORK=mainnet.");
  }
  const issuer = process.env.STELLAR_USDC_ISSUER?.trim();
  if (!issuer || !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error("STELLAR_USDC_ISSUER must be a valid Stellar Mainnet issuer address.");
  }
  return {
    network: "MAINNET",
    networkLabel: "Stellar Mainnet",
    networkPassphrase: Networks.PUBLIC,
    horizonUrl: process.env.STELLAR_HORIZON_URL?.trim() || "https://horizon.stellar.org",
    assetCode: "USDC",
    assetIssuer: issuer,
    explorerBaseUrl: "https://stellar.expert/explorer/public/tx",
  };
}

export function getHorizonServer(config = getStellarConfig()) {
  return new Horizon.Server(config.horizonUrl);
}

export function getUsdcAsset(config = getStellarConfig()) {
  return new Asset(config.assetCode, config.assetIssuer);
}

export function explorerTransactionUrl(transactionHash: string, config = getStellarConfig()) {
  return `${config.explorerBaseUrl}/${encodeURIComponent(transactionHash)}`;
}

export function normalizeStellarAmount(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) {
    throw new Error("Enter a valid USDC amount with up to 7 decimal places.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalized = `${normalizedWhole}.${fraction.padEnd(7, "0")}`;
  const stroops = BigInt(normalizedWhole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
  if (stroops <= 0n) throw new Error("Amount must be greater than zero.");
  if (stroops > 9_223_372_036_854_775_807n) throw new Error("Amount exceeds Stellar's maximum transaction amount.");
  return normalized;
}

export function stellarAmountToStroops(value: string) {
  const normalized = normalizeStellarAmount(value);
  const [whole, fraction] = normalized.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction);
}

export function createPaymentUri({
  destination,
  amount,
  memo,
  config = getStellarConfig(),
}: {
  destination: string;
  amount: string;
  memo: string;
  config?: StellarConfig;
}) {
  if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error("A valid Stellar destination is required.");
  if (!memo || Buffer.byteLength(memo, "utf8") > 28) throw new Error("Stellar memo must be between 1 and 28 bytes.");
  const parameters = new URLSearchParams({
    destination,
    amount: normalizeStellarAmount(amount),
    memo,
    memo_type: "MEMO_TEXT",
    msg: "Pay this Rupi invoice in USDC on Stellar Mainnet.",
    asset_issuer: config.assetIssuer,
    asset_code: config.assetCode,
    network_passphrase: config.networkPassphrase,
  });
  return `web+stellar:pay?${parameters.toString()}`;
}

export async function getTransactionMemo(transactionHash: string, config = getStellarConfig()) {
  const transaction = await getHorizonServer(config).transactions().transaction(transactionHash).call();
  const result = transaction as { memo?: string; memo_type?: string };
  return result.memo_type === "text" ? result.memo || null : null;
}

export function isMainnet(config = getStellarConfig()) {
  return config.network === "MAINNET";
}

export { Memo };
