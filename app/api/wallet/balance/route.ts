import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { isProductAppEnabled } from "@/lib/flags";
import { getWallet, getWalletBalance } from "@/lib/wallets";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const [wallet, balance] = await Promise.all([getWallet(user.id), getWalletBalance(user.id)]);
    return NextResponse.json({
      wallet: wallet ? { id: wallet.id, network: wallet.network, publicKey: wallet.public_key, status: wallet.provision_status } : null,
      balance,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load wallet balance.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
