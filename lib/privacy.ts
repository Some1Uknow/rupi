import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  const value = process.env.WAITLIST_UNSUBSCRIBE_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("WAITLIST_UNSUBSCRIBE_SECRET must be configured.");
  return value;
}

export function createUnsubscribeToken(email: string) {
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + 365 * 24 * 60 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(token: string, email: string) {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) return false;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (given.length !== expectedBytes.length || !timingSafeEqual(given, expectedBytes)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string; exp?: number };
    return parsed.email === email.toLowerCase() && typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}
