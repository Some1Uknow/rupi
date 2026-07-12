import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RUPI_RELEASE_SHA || "unknown";
  const expected = process.env.RUPI_EXPECTED_RELEASE_SHA;
  if (expected && commit !== expected) {
    return NextResponse.json({ ok: false, error: "Release SHA mismatch." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ ok: true, commit }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Database unavailable.", commit }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
