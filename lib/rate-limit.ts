import { createHash } from "crypto";
import { isLocalDevelopment } from "./env";
import { logEvent } from "./observability";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests. Please try again shortly.");
  }
}

function requestIdentifier(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const ip = forwarded || realIp || "unknown";
  return createHash("sha256").update(ip).digest("base64url").slice(0, 32);
}

function rateLimitConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (isLocalDevelopment()) return null;
    throw new Error("Durable rate limiting is not configured.");
  }
  return { url: url.replace(/\/$/, ""), token };
}

/** A fixed-window limiter backed by Upstash Redis REST, never process memory. */
export async function enforceRateLimit({
  request,
  namespace,
  limit,
  windowSeconds,
  subject,
}: {
  request: Request;
  namespace: string;
  limit: number;
  windowSeconds: number;
  subject?: string;
}) {
  const config = rateLimitConfig();
  if (!config) return;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const identity = subject || requestIdentifier(request);
  const key = `rupi:ratelimit:${namespace}:${identity}:${bucket}`;
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSeconds + 1), "NX"],
    ]),
    signal: AbortSignal.timeout(2_500),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Durable rate limiter is unavailable.");
  const result = (await response.json()) as Array<{ result?: number | string }>;
  const count = Number(result[0]?.result);
  if (!Number.isFinite(count)) throw new Error("Durable rate limiter returned an invalid response.");
  if (count > limit) {
    const retryAfterSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
    logEvent("warn", "RATE_LIMIT_EXCEEDED", { namespace, limit, windowSeconds });
    throw new RateLimitError(Math.max(1, retryAfterSeconds));
  }
}

export function rateLimitResponse(error: unknown) {
  if (error instanceof RateLimitError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(error.retryAfterSeconds) },
    });
  }
  return null;
}
