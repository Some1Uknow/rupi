import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth, ensureAccountProfile } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { captureException } from "@/lib/observability";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getPool } from "@/lib/db";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

function authFailureResponse(error: unknown) {
  captureException(error, "AUTH_ROUTE_FAILED");
  return NextResponse.json(
    { error: "Authentication service failed." },
    { status: 500 },
  );
}

async function throttle(request: Request) {
  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith("/email-otp/send-verification-otp")) {
      await enforceRateLimit({ request, namespace: "auth:otp", limit: 3, windowSeconds: 10 * 60 });
    } else {
      await enforceRateLimit({ request, namespace: "auth", limit: 12, windowSeconds: 60 });
    }
    return null;
  } catch (error) {
    return rateLimitResponse(error) || NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}

async function recordAuthentication(response: Response) {
  if (!response.ok) return;
  const body = (await response.clone().json().catch(() => null)) as { user?: { id?: string } } | null;
  const userId = body?.user?.id;
  if (!userId) return;
  await ensureAccountProfile(userId);
  await recordAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    type: "AUTHENTICATED_WITH_EMAIL_OTP",
    message: "Email OTP authentication succeeded.",
  });
}

async function assertSignupOpen(request: Request) {
  const path = new URL(request.url).pathname;
  if (!path.endsWith("/sign-in/email-otp") && !path.endsWith("/email-otp/send-verification-otp")) return;
  const body = await request.clone().json().catch(() => null) as { email?: unknown } | null;
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) return;
  const existing = await getPool().query("SELECT 1 FROM \"user\" WHERE \"email\" = $1", [email]);
  if (existing.rowCount) return;
  const control = await getPool().query<{ is_paused: boolean; reason: string | null }>(
    "SELECT is_paused, reason FROM operator_controls WHERE control_key = 'SIGNUP'",
  );
  if (control.rows[0]?.is_paused) throw new Error(control.rows[0].reason || "Sign-up is temporarily paused.");
}

export async function GET(request: Request) {
  try {
    return handlers.GET(request);
  } catch (error) {
    return authFailureResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const limited = await throttle(request);
    if (limited) return limited;
    await assertSignupOpen(request);
    const response = await handlers.POST(request);
    if (new URL(request.url).pathname.endsWith("/sign-in/email-otp")) {
      await recordAuthentication(response);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Cross-site request blocked.") {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
    if (error instanceof Error && error.message.includes("Sign-up is temporarily paused.")) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return authFailureResponse(error);
  }
}
