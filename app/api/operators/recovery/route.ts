import { NextResponse } from "next/server";
import { getPool, withTransaction } from "@/lib/db";
import { requireOperator, operatorUnauthorized } from "@/lib/operator";
import { readJsonBody } from "@/lib/http";
import { recordAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireOperator(request)) return operatorUnauthorized();
  const result = await getPool().query(
    `SELECT user_id, account_state, kyc_state, recovery_locked_until, updated_at
     FROM account_profiles WHERE account_state = 'RECOVERY_REVIEW'
     ORDER BY updated_at ASC LIMIT 100`,
  );
  return NextResponse.json({ accounts: result.rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const operatorId = requireOperator(request);
  if (!operatorId) return operatorUnauthorized();
  try {
    const body = await readJsonBody<{ action?: unknown; userId?: unknown }>(request);
    const userId = String(body.userId || "");
    if (!userId || body.action !== "APPROVE_RESET_PASSKEY") {
      return NextResponse.json({ error: "Action must be APPROVE_RESET_PASSKEY with a userId." }, { status: 400 });
    }
    const approved = await withTransaction(async (client) => {
      const profile = await client.query<{ account_state: string }>(
        `SELECT account_state FROM account_profiles WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (profile.rows[0]?.account_state !== "RECOVERY_REVIEW") return false;
      await client.query("DELETE FROM passkeys WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM passkey_challenges WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM step_up_tokens WHERE user_id = $1", [userId]);
      await client.query(
        "UPDATE account_profiles SET account_state = 'PENDING_PASSKEY', recovery_locked_until = NULL, updated_at = NOW() WHERE user_id = $1",
        [userId],
      );
      return true;
    });
    if (!approved) return NextResponse.json({ error: "Account is not awaiting recovery review." }, { status: 409 });
    await recordAuditEvent({
      userId,
      actorType: "OPERATOR",
      actorId: operatorId,
      type: "ACCOUNT_RECOVERY_APPROVED",
      message: "Operator approved passkey reset after manual recovery review.",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not process recovery." }, { status: 400 });
  }
}
