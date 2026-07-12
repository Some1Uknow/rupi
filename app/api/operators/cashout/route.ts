import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireOperator, operatorUnauthorized } from "@/lib/operator";
import { pollOnrampOrder, requestCashoutRefund } from "@/lib/cashout";
import { readJsonBody } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireOperator(request)) return operatorUnauthorized();
  const result = await getPool().query(
    `SELECT id, state, provider_order_id, fireblocks_transaction_id, hold_reason, created_at, updated_at
     FROM offramp_orders
     WHERE state IN ('HELD', 'MANUAL_REVIEW', 'SUBMISSION_UNKNOWN', 'REFUND_PENDING')
     ORDER BY updated_at ASC LIMIT 100`,
  );
  return NextResponse.json({ orders: result.rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const operatorId = requireOperator(request);
  if (!operatorId) return operatorUnauthorized();
  try {
    const body = await readJsonBody<{ action?: unknown; orderId?: unknown; reason?: unknown }>(request);
    const orderId = String(body.orderId || "");
    if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
    if (body.action === "RECONCILE") {
      await pollOnrampOrder(orderId);
    } else if (body.action === "REFUND") {
      await requestCashoutRefund({ orderId, reason: String(body.reason || "Operator review"), operatorId });
    } else {
      return NextResponse.json({ error: "Action must be RECONCILE or REFUND." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operator action failed." }, { status: 400 });
  }
}
