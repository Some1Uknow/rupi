import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireOperator, operatorUnauthorized } from "@/lib/operator";
import { readJsonBody } from "@/lib/http";
import { recordAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireOperator(request)) return operatorUnauthorized();
  const result = await getPool().query<{ control_key: string; is_paused: boolean; reason: string | null; updated_at: string }>(
    "SELECT control_key, is_paused, reason, updated_at FROM operator_controls ORDER BY control_key",
  );
  return NextResponse.json({ controls: result.rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const operatorId = requireOperator(request);
  if (!operatorId) return operatorUnauthorized();
  try {
    const body = await readJsonBody<{ control?: unknown; paused?: unknown; reason?: unknown }>(request);
    const control = String(body.control || "").toUpperCase();
    if (!new Set(["SIGNUP", "INVOICES", "SIGNING", "CASHOUT"]).has(control) || typeof body.paused !== "boolean") {
      return NextResponse.json({ error: "Invalid control update." }, { status: 400 });
    }
    const reason = String(body.reason || "").trim().slice(0, 500) || null;
    await getPool().query(
      `UPDATE operator_controls SET is_paused = $2, reason = $3, updated_by = $4, updated_at = NOW() WHERE control_key = $1`,
      [control, body.paused, reason, operatorId],
    );
    await recordAuditEvent({ actorType: "OPERATOR", actorId: operatorId, type: "OPERATOR_CONTROL_UPDATED", message: "An operator updated a launch control.", metadata: { control, paused: body.paused } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update control." }, { status: 400 });
  }
}
