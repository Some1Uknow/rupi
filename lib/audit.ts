import { getPool } from "./db";
import { logEvent } from "./observability";

export async function recordAuditEvent({
  userId = null,
  actorType = "SYSTEM",
  actorId = null,
  type,
  message,
  metadata = {},
}: {
  userId?: string | null;
  actorType?: "SYSTEM" | "USER" | "OPERATOR" | "PROVIDER";
  actorId?: string | null;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  await getPool().query(
    `INSERT INTO audit_events (user_id, actor_type, actor_id, type, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [userId, actorType, actorId, type, message, JSON.stringify(metadata)],
  );
  logEvent("info", type, { userId: userId || undefined, actorType, actorId: actorId || undefined });
}
