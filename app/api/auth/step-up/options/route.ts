import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { beginStepUp } from "@/lib/passkeys";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { apiError, readJsonBody } from "@/lib/http";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "passkey:step-up", limit: 8, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ action?: unknown; amount?: unknown; idempotencyKey?: unknown }>(request);
    const options = await beginStepUp({
      userId: user.id,
      action: String(body.action || ""),
      amount: typeof body.amount === "string" ? body.amount : undefined,
      idempotencyKey: String(body.idempotencyKey || ""),
    });
    return NextResponse.json({ options }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not start passkey authorization.", 503);
  }
}
