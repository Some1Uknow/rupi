import { NextResponse } from "next/server";
import { YIELD_UNAVAILABLE } from "@/lib/yield";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(YIELD_UNAVAILABLE, { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
}

export async function POST() {
  return NextResponse.json(YIELD_UNAVAILABLE, { status: 410, headers: { "Cache-Control": "public, max-age=3600" } });
}
