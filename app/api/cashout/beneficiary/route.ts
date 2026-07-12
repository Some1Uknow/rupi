import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { getBeneficiary, startBeneficiarySession } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";
import { apiError, readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site";
import { consumeStepUpToken } from "@/lib/passkeys";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ beneficiary: await getBeneficiary(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "cashout:beneficiary", limit: 3, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ returnPath?: unknown; idempotencyKey?: unknown; stepUpToken?: unknown }>(request);
    const returnPath = typeof body.returnPath === "string" && body.returnPath.startsWith("/") ? body.returnPath : "/cashout";
    const idempotencyKey = String(body.idempotencyKey || "");
    await consumeStepUpToken({ userId: user.id, action: "BENEFICIARY_CHANGE", idempotencyKey, token: String(body.stepUpToken || "") });
    const session = await startBeneficiarySession({ userId: user.id, returnUrl: new URL(returnPath, getSiteUrl()).toString() });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not start secure bank account setup.", 503);
  }
}
