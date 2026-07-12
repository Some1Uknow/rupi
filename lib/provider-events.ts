import { createHash } from "crypto";
import { getPool } from "./db";
import { processFireblocksWebhook, processOnrampWebhook } from "./cashout";
import { captureException, logEvent } from "./observability";

export type WebhookProvider = "FIREBLOCKS" | "ONRAMP";

function providerEventId(payload: Record<string, unknown>, rawBody: string, headerId: string | null) {
  const candidate = headerId || payload.eventId || payload.event_id || payload.webhookId || payload.webhook_id;
  // Transaction/order IDs are not event IDs; a hash preserves subsequent status events.
  if (typeof candidate === "string") {
    const id = candidate.trim();
    if (id && id.length <= 250) return id;
  }
  return createHash("sha256").update(rawBody).digest("hex");
}

function redact(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    const normalized = childKey.toLowerCase();
    if (
      /^(email|phone|mobile|pan|aadhaar|document|accountnumber|account_number|address|otp|password)$/i.test(normalized) ||
      (normalized.includes("account") && !normalized.includes("last4"))
    ) continue;
    result[childKey] = redact(childValue, childKey);
  }
  return result;
}

export async function enqueueProviderEvent({
  provider,
  rawBody,
  payload,
  signatureTimestamp,
  eventId,
}: {
  provider: WebhookProvider;
  rawBody: string;
  payload: Record<string, unknown>;
  signatureTimestamp: Date | null;
  eventId: string | null;
}) {
  const id = providerEventId(payload, rawBody, eventId);
  const occurred = payload.occurredAt || payload.createdAt || payload.timestamp;
  const occurredAt = typeof occurred === "string" || typeof occurred === "number" ? new Date(occurred) : null;
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO provider_webhook_events (provider, provider_event_id, occurred_at, signature_timestamp, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
    [
      provider,
      id,
      occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt.toISOString() : null,
      signatureTimestamp?.toISOString() || null,
      JSON.stringify(redact(payload)),
    ],
  );
  return { accepted: Boolean(result.rowCount), eventId: id };
}

export async function processProviderEvent({ provider, payload }: { provider: WebhookProvider; payload: Record<string, unknown> }) {
  if (provider === "FIREBLOCKS") await processFireblocksWebhook(payload);
  else await processOnrampWebhook(payload);
}

export async function processPendingProviderEvents(limit = 100) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{ id: string; provider: WebhookProvider; payload: Record<string, unknown> }>(
      `SELECT id, provider, payload FROM provider_webhook_events
       WHERE processed_at IS NULL
         AND (processing_started_at IS NULL OR processing_started_at < NOW() - INTERVAL '10 minutes')
       ORDER BY received_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [Math.min(Math.max(limit, 1), 250)],
    );
    await client.query(
      `UPDATE provider_webhook_events
       SET attempts = attempts + 1, processing_started_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [selected.rows.map((row) => row.id)],
    );
    await client.query("COMMIT");
    const outcomes: Array<{ id: string; status: "PROCESSED" | "RETRY" }> = [];
    for (const event of selected.rows) {
      try {
        await processProviderEvent(event);
        await getPool().query(
          "UPDATE provider_webhook_events SET processed_at = NOW(), processing_started_at = NULL, last_error = NULL WHERE id = $1",
          [event.id],
        );
        outcomes.push({ id: event.id, status: "PROCESSED" });
      } catch (error) {
        captureException(error, "PROVIDER_EVENT_PROCESSING_FAILED", { provider: event.provider, eventId: event.id });
        await getPool().query(
          "UPDATE provider_webhook_events SET processing_started_at = NULL, last_error = $2 WHERE id = $1",
          [event.id, error instanceof Error ? error.message.slice(0, 300) : "Provider event processing failed."],
        );
        outcomes.push({ id: event.id, status: "RETRY" });
      }
    }
    return outcomes;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function logWebhookAccepted(provider: WebhookProvider, accepted: boolean) {
  logEvent("info", "PROVIDER_WEBHOOK_RECEIVED", { provider, accepted });
}
