import { createHmac, timingSafeEqual } from "crypto";

function normalizeSignature(value: string) {
  return value.trim().replace(/^sha256=/i, "");
}

/** Verifies a provider HMAC without parsing or reserializing the raw body. */
export function verifyHmacWebhook({ secret, rawBody, signature, timestamp }: { secret: string; rawBody: string; signature: string | null; timestamp: string | null }) {
  if (!signature || !timestamp) return false;
  // The signed timestamp binds freshness to the authenticated payload.
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const supplied = normalizeSignature(signature);
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function parseProviderTimestamp(value: string | null) {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isFreshWebhookTimestamp(value: string | null, maxAgeMs = 5 * 60_000) {
  const parsed = parseProviderTimestamp(value);
  return Boolean(parsed && Math.abs(Date.now() - parsed.getTime()) <= maxAgeMs);
}
