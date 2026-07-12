import { NextResponse } from "next/server";
import { getAccountProfile, getPasskeyAssuredUser } from "@/lib/auth";
import { isProductAppEnabled } from "@/lib/flags";
import { ensureWalletForUser } from "@/lib/wallets";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const profile = await getAccountProfile(user.id);
  if (!profile || profile.account_state === "PENDING_PASSKEY") {
    return NextResponse.json({ error: "Enroll a passkey before setting up custody." }, { status: 403 });
  }

  try {
    assertSameOrigin(request);
    const wallet = await ensureWalletForUser({ userId: user.id, displayName: user.name });
    return NextResponse.json({ wallet: { id: wallet.id, network: wallet.network, publicKey: wallet.public_key, status: wallet.provision_status } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet setup failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
