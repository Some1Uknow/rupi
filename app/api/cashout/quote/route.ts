import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ error: "This endpoint has moved to POST /api/cashout/quotes." }, { status: 410 });
}
