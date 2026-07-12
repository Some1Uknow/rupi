import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { startKycSession } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";
import { apiError, readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "cashout:kyc", limit: 3, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ returnPath?: unknown }>(request);
    const returnPath = typeof body.returnPath === "string" && body.returnPath.startsWith("/") ? body.returnPath : "/cashout";
    const session = await startKycSession({ userId: user.id, email: user.email, returnUrl: new URL(returnPath, getSiteUrl()).toString() });
    return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not start KYC.", 503);
  }
}
