import { NextResponse } from "next/server";
import { ensureAccountProfile, getAccountProfile, getCurrentUser } from "@/lib/auth";
import { beginPasskeyEnrollment } from "@/lib/passkeys";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "passkey:enroll", limit: 5, windowSeconds: 10 * 60, subject: user.id });
    await ensureAccountProfile(user.id);
    const profile = await getAccountProfile(user.id);
    if (!profile || profile.account_state !== "PENDING_PASSKEY") {
      return NextResponse.json({ error: "An existing account cannot add a passkey with email OTP alone." }, { status: 403 });
    }
    const options = await beginPasskeyEnrollment({ userId: user.id, email: user.email, displayName: user.name });
    return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not start passkey enrollment.", 503);
  }
}
