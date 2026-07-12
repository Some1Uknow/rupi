import { createHash, createHmac, timingSafeEqual } from "crypto";
import { getRequiredServerUrl } from "../env";
import { verifyHmacWebhook } from "./webhook";
import { logEvent } from "../observability";

export type OnrampNetwork = {
  id: string;
  symbol: string;
  memoSupported: boolean;
  minAmount?: string;
  maxAmount?: string;
};

export type OnrampConfiguration = {
  coins: Array<{ id: string; coinCode: string; networks: OnrampNetwork[] }>;
  raw: Record<string, unknown>;
};

export type OnrampQuote = {
  id: string;
  coinCode: "usdc";
  networkId: string;
  networkSymbol: "xlm";
  usdcAmount: string;
  grossInr: string;
  onrampFeeInr: string;
  gatewayFeeInr: string;
  tdsInr: string;
  rupiFeeInr: string;
  netInr: string;
  expiresAt: string;
  signature: string;
  raw: Record<string, unknown>;
};

export type OnrampOrder = {
  id: string;
  coinCode: "usdc";
  networkId: string;
  networkSymbol: "xlm";
  usdcAmount: string;
  depositAddress: string;
  depositMemo: string;
  status: string;
  raw: Record<string, unknown>;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function configuredPath(name: string, fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  return value.startsWith("/") ? value : `/${value}`;
}

function signature({ timestamp, method, path, body }: { timestamp: string; method: string; path: string; body: string }) {
  return createHmac("sha256", required("ONRAMP_API_SECRET"))
    .update(`${timestamp}.${method}.${path}.${body}`)
    .digest("hex");
}

function metricPath(path: string) {
  return path.split("?")[0].replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:id");
}

async function request<T>(method: "GET" | "POST", path: string, payload?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const base = getRequiredServerUrl("ONRAMP_API_BASE_URL");
  const body = payload ? JSON.stringify(payload) : "";
  const timestamp = String(Date.now());
  const startedAt = Date.now();
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-App-Id": required("ONRAMP_APP_ID"),
      "X-Api-Key": required("ONRAMP_API_KEY"),
      "X-Timestamp": timestamp,
      "X-Signature": signature({ timestamp, method, path, body }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  logEvent(response.ok ? "info" : "warn", "ONRAMP_REQUEST", { method, path: metricPath(path), status: response.status, latencyMs: Date.now() - startedAt });
  if (!response.ok) throw new Error(`Onramp request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Onramp returned an invalid response.");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string) {
  const result = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!result) throw new Error(`Onramp response is missing ${name}.`);
  return result;
}

/**
 * Private partner contract: Onramp HMAC-signs this canonical, normalized
 * payload and returns the same string as signedPayload. A response that is
 * merely TLS-authenticated is not sufficient to authorize a custody transfer.
 */
function verifyQuoteSignature(signedPayload: string, signatureValue: string) {
  const expected = createHmac("sha256", required("ONRAMP_QUOTE_SIGNING_SECRET")).update(signedPayload).digest("hex");
  const supplied = signatureValue.trim().replace(/^sha256=/i, "");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw new Error("Onramp quote signature could not be verified. Cash-out is paused.");
  }
}

function quoteFrom(response: unknown): OnrampQuote {
  const object = asObject(response);
  const quote = asObject(object.data || object.quote || object);
  const network = String(quote.networkSymbol || quote.network || "").toLowerCase();
  const coin = String(quote.coinCode || quote.coin || "").toLowerCase();
  if (coin !== "usdc" || network !== "xlm") throw new Error("Onramp quote is not for Stellar USDC.");
  const values = {
    id: stringValue(quote.quoteId || quote.id, "quote ID"),
    networkId: stringValue(quote.networkId || quote.network_id, "Stellar network ID"),
    usdcAmount: stringValue(quote.usdcAmount || quote.coinAmount || quote.amount, "USDC amount"),
    grossInr: stringValue(quote.grossInr || quote.grossAmountInr, "gross INR"),
    onrampFeeInr: stringValue(quote.onrampFeeInr || quote.providerFeeInr || 0, "Onramp fee"),
    gatewayFeeInr: stringValue(quote.gatewayFeeInr || 0, "gateway fee"),
    tdsInr: stringValue(quote.tdsInr || 0, "TDS"),
    rupiFeeInr: stringValue(quote.rupiFeeInr || quote.merchantFeeInr, "Rupi fee"),
    netInr: stringValue(quote.netInr || quote.netAmountInr, "net INR"),
    expiresAt: stringValue(quote.expiresAt || quote.expiry, "quote expiry"),
  };
  const canonicalPayload = JSON.stringify({
    quoteId: values.id,
    coinCode: "usdc",
    networkId: values.networkId,
    networkSymbol: "xlm",
    usdcAmount: values.usdcAmount,
    grossInr: values.grossInr,
    onrampFeeInr: values.onrampFeeInr,
    gatewayFeeInr: values.gatewayFeeInr,
    tdsInr: values.tdsInr,
    rupiFeeInr: values.rupiFeeInr,
    netInr: values.netInr,
    expiresAt: values.expiresAt,
  });
  const signedPayload = stringValue(quote.signedPayload, "signed quote payload");
  const quoteSignature = stringValue(quote.signature || quote.quoteSignature, "quote signature");
  if (signedPayload !== canonicalPayload) throw new Error("Onramp signed quote payload does not match its returned values.");
  verifyQuoteSignature(canonicalPayload, quoteSignature);
  return {
    id: values.id,
    coinCode: "usdc",
    networkId: values.networkId,
    networkSymbol: "xlm",
    usdcAmount: values.usdcAmount,
    grossInr: values.grossInr,
    onrampFeeInr: values.onrampFeeInr,
    gatewayFeeInr: values.gatewayFeeInr,
    tdsInr: values.tdsInr,
    rupiFeeInr: values.rupiFeeInr,
    netInr: values.netInr,
    expiresAt: values.expiresAt,
    signature: quoteSignature,
    raw: quote,
  };
}

function configurationFrom(response: unknown): OnrampConfiguration {
  const object = asObject(response);
  const root = asObject(object.data || object);
  const candidates = root.coins || root.assets || root.supportedCoins;
  if (!Array.isArray(candidates)) throw new Error("Onramp configuration does not include supported coins.");
  const coins = candidates.map((entry) => {
    const coin = asObject(entry);
    const networks = coin.networks || coin.networkList;
    if (!Array.isArray(networks)) throw new Error("Onramp configuration is missing a coin network list.");
    return {
      id: stringValue(coin.id || coin.coinId || coin.coinCode, "coin ID"),
      coinCode: stringValue(coin.coinCode || coin.code || coin.symbol, "coin code").toLowerCase(),
      networks: networks.map((entry) => {
        const network = asObject(entry);
        return {
          id: stringValue(network.id || network.networkId || network.symbol, "network ID"),
          symbol: stringValue(network.symbol || network.network || network.code, "network symbol").toLowerCase(),
          memoSupported: Boolean(network.memoSupported || network.supportsMemo || network.memoRequired),
          minAmount: typeof network.minAmount === "string" ? network.minAmount : undefined,
          maxAmount: typeof network.maxAmount === "string" ? network.maxAmount : undefined,
        };
      }),
    };
  });
  return { coins, raw: root };
}

export function selectStellarUsdc(configuration: OnrampConfiguration) {
  const coin = configuration.coins.find((item) => item.coinCode === "usdc");
  const network = coin?.networks.find((item) => item.symbol === "xlm");
  if (!coin || !network || !network.memoSupported || !network.minAmount || !network.maxAmount) {
    throw new Error("Onramp Stellar USDC, memo support, or settlement limits are unavailable. Cash-out is paused.");
  }
  return { coin, network };
}

/**
 * Private white-label Onramp adapter. The URL paths can be supplied with the
 * partner entitlement; unknown/nonconforming provider responses fail closed.
 */
export const onramp = {
  async getConfiguration() {
    const result = await request<unknown>("GET", configuredPath("ONRAMP_CONFIGURATION_PATH", "/partner/v1/configuration"));
    return configurationFrom(result);
  },

  async createKycSession({ providerCustomerId, email, returnUrl }: { providerCustomerId?: string | null; email: string; returnUrl: string }) {
    return request<Record<string, unknown>>("POST", configuredPath("ONRAMP_KYC_SESSION_PATH", "/partner/v1/customers/kyc-sessions"), {
      customerId: providerCustomerId || undefined,
      email,
      returnUrl,
      brand: "Rupi",
    });
  },

  async getKycStatus(providerCustomerId: string) {
    return request<Record<string, unknown>>("GET", `${configuredPath("ONRAMP_KYC_STATUS_PATH", "/partner/v1/customers")}/${encodeURIComponent(providerCustomerId)}/kyc-status`);
  },

  async createBeneficiarySession({ providerCustomerId, returnUrl }: { providerCustomerId: string; returnUrl: string }) {
    return request<Record<string, unknown>>("POST", configuredPath("ONRAMP_BENEFICIARY_SESSION_PATH", "/partner/v1/beneficiaries/sessions"), {
      customerId: providerCustomerId,
      returnUrl,
      brand: "Rupi",
    });
  },

  async createQuote({ providerCustomerId, beneficiaryToken, amount, networkId }: { providerCustomerId: string; beneficiaryToken: string; amount: string; networkId: string }) {
    const response = await request<unknown>("POST", configuredPath("ONRAMP_QUOTE_PATH", "/partner/v1/offramp/quotes"), {
      customerId: providerCustomerId,
      beneficiaryToken,
      coinCode: "usdc",
      networkId,
      amount,
      merchantFeeBps: 50,
      merchantFeeLabel: "Rupi fee",
    });
    return quoteFrom(response);
  },

  async createOrder({
    providerCustomerId,
    beneficiaryToken,
    providerQuoteId,
    idempotencyKey,
  }: {
    providerCustomerId: string;
    beneficiaryToken: string;
    providerQuoteId: string;
    idempotencyKey: string;
  }) {
    const response = await request<unknown>("POST", configuredPath("ONRAMP_ORDER_PATH", "/partner/v1/offramp/orders"), {
      customerId: providerCustomerId,
      beneficiaryToken,
      quoteId: providerQuoteId,
      coinCode: "usdc",
      networkSymbol: "xlm",
      idempotencyKey,
    }, idempotencyKey);
    const object = asObject(response);
    const order = asObject(object.data || object.order || object);
    const coinCode = String(order.coinCode || order.coin || "").toLowerCase();
    const networkSymbol = String(order.networkSymbol || order.network || "").toLowerCase();
    if (coinCode !== "usdc" || networkSymbol !== "xlm") {
      throw new Error("Onramp order is not for Stellar USDC.");
    }
    return {
      id: stringValue(order.orderId || order.id, "order ID"),
      coinCode: "usdc",
      networkId: stringValue(order.networkId || order.network_id, "Stellar network ID"),
      networkSymbol: "xlm",
      usdcAmount: stringValue(order.usdcAmount || order.coinAmount || order.amount, "USDC amount"),
      depositAddress: stringValue(order.depositAddress || order.address, "Stellar deposit address"),
      depositMemo: stringValue(order.depositMemo || order.memo || order.tag, "Stellar deposit memo"),
      status: stringValue(order.status || "ORDER_CREATED", "order status"),
      raw: order,
    } satisfies OnrampOrder;
  },

  async getOrderStatus(providerOrderId: string) {
    return request<Record<string, unknown>>("GET", `${configuredPath("ONRAMP_ORDER_PATH", "/partner/v1/offramp/orders")}/${encodeURIComponent(providerOrderId)}`);
  },

  async cancelOrRefund(providerOrderId: string, reason: string) {
    return request<Record<string, unknown>>("POST", `${configuredPath("ONRAMP_ORDER_PATH", "/partner/v1/offramp/orders")}/${encodeURIComponent(providerOrderId)}/refunds`, { reason });
  },

  async getMerchantHistory() {
    return request<Record<string, unknown>>("GET", configuredPath("ONRAMP_MERCHANT_HISTORY_PATH", "/partner/v1/merchant/history"));
  },

  configurationHash(configuration: OnrampConfiguration) {
    return createHash("sha256").update(JSON.stringify(configuration.raw)).digest("hex");
  },

  verifyWebhook(rawBody: string, signature: string | null, timestamp: string | null) {
    return verifyHmacWebhook({ secret: required("ONRAMP_WEBHOOK_SECRET"), rawBody, signature, timestamp });
  },
};
