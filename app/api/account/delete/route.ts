import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/csrf";
import { consumeStepUpToken } from "@/lib/passkeys";
import { readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "account:delete", limit: 3, windowSeconds: 24 * 60 * 60, subject: user.id });
    const body = await readJsonBody<{ idempotencyKey?: unknown; stepUpToken?: unknown }>(request);
    await consumeStepUpToken({
      userId: user.id,
      action: "SECURITY_SETTINGS",
      idempotencyKey: String(body.idempotencyKey || ""),
      token: String(body.stepUpToken || ""),
    });
    const existing = await getPool().query(
      "SELECT 1 FROM data_deletion_requests WHERE user_id = $1 AND status IN ('PENDING', 'HELD_FOR_COMPLIANCE')",
      [user.id],
    );
    if (!existing.rowCount) {
      await getPool().query(
        "INSERT INTO data_deletion_requests (user_id, email) VALUES ($1, $2)",
        [user.id, user.email.toLowerCase()],
      );
      await recordAuditEvent({ userId: user.id, actorType: "USER", actorId: user.id, type: "DATA_DELETION_REQUESTED", message: "A passkey-authorized data deletion request was submitted." });
    }
    return NextResponse.json({ ok: true, message: "Your request was recorded. Regulated financial records may be retained where required by law." });
  } catch (error) {
    return rateLimitResponse(error) || NextResponse.json({ error: error instanceof Error ? error.message : "Could not submit the deletion request." }, { status: 400 });
  }
}
