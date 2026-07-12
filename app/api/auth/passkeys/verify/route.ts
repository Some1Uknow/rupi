import { NextResponse } from "next/server";
import { getCurrentAuthSession, markSessionPasskeyAssured } from "@/lib/auth";
import { finishPasskeyEnrollment } from "@/lib/passkeys";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { apiError, readJsonBody } from "@/lib/http";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const current = await getCurrentAuthSession();
  const user = current?.user;
  if (!user || !current) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "passkey:enroll:verify", limit: 8, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ response?: unknown; name?: unknown }>(request);
    if (!body.response || typeof body.response !== "object") return NextResponse.json({ error: "Passkey response is required." }, { status: 400 });
    await finishPasskeyEnrollment({
      userId: user.id,
      response: body.response as never,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    await markSessionPasskeyAssured({ sessionId: current.session.id, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not verify passkey enrollment.");
  }
}
