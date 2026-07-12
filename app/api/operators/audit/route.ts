import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireOperator, operatorUnauthorized } from "@/lib/operator";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireOperator(request)) return operatorUnauthorized();
  const result = await getPool().query(
    `SELECT id, actor_type, actor_id, type, message, metadata, created_at
     FROM audit_events ORDER BY created_at DESC LIMIT 1000`,
  );
  return NextResponse.json({ events: result.rows }, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"rupi-audit-events.json\"",
    },
  });
}
