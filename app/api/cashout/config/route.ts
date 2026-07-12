import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { getCashoutConfig } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json(await getCashoutConfig(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, providerAvailable: false, kycState: "UNKNOWN", caps: { perTransactionInr: "25000.00", rolling24hInr: "50000.00", rupiFeeBps: 50 } }, { headers: { "Cache-Control": "no-store" } });
  }
}
