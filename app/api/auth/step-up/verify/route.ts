import { NextResponse } from "next/server";
import { getCurrentAuthSession, markSessionPasskeyAssured } from "@/lib/auth";
import { finishStepUp } from "@/lib/passkeys";
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
    await enforceRateLimit({ request, namespace: "passkey:step-up:verify", limit: 8, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ response?: unknown }>(request);
    if (!body.response || typeof body.response !== "object") return NextResponse.json({ error: "Passkey response is required." }, { status: 400 });
    const authorization = await finishStepUp({ userId: user.id, response: body.response as never });
    await markSessionPasskeyAssured({ sessionId: current.session.id, userId: user.id });
    return NextResponse.json({ authorization }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not verify passkey authorization.");
  }
}
