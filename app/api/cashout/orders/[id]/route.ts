import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { getCashoutOrder } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await params;
  const order = await getCashoutOrder(id, user.id);
  if (!order) return NextResponse.json({ error: "Cash-out order not found." }, { status: 404 });
  return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
}
