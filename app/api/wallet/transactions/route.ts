import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { isProductAppEnabled } from "@/lib/flags";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ activity: await listActivity(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
