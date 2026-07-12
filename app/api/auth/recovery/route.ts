import { NextResponse } from "next/server";
import { getCurrentAuthSession } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { assertSameOrigin } from "@/lib/csrf";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { captureException } from "@/lib/observability";

export const runtime = "nodejs";

async function sendRecoveryNotice(email: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Security email delivery is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Rupi account recovery started",
      text: "A Rupi account recovery was started with your verified email. All sessions were revoked and the account is locked for manual review. If this was not you, contact the grievance team immediately.",
    }),
    signal: AbortSignal.timeout(7_500),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not send the account recovery notice.");
}

/**
 * A verified-email OTP session can initiate recovery, but never completes it.
 * Recovery revokes every session and locks the account until manual review.
 */
export async function POST(request: Request) {
  const current = await getCurrentAuthSession();
  if (!current?.user.email) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "auth:recovery", limit: 2, windowSeconds: 24 * 60 * 60, subject: current.user.id });
    const profile = await getPool().query<{ recovery_locked_until: string | null }>(
      "SELECT recovery_locked_until FROM account_profiles WHERE user_id = $1",
      [current.user.id],
    );
    const lockedUntil = profile.rows[0]?.recovery_locked_until;
    if (lockedUntil && Date.parse(lockedUntil) > Date.now()) {
      return NextResponse.json({ ok: true, message: "Recovery is already under review. Check your verified email for next steps." });
    }
    await getPool().query(
      "UPDATE account_profiles SET account_state = 'RECOVERY_REVIEW', recovery_locked_until = NOW() + INTERVAL '24 hours', updated_at = NOW() WHERE user_id = $1",
      [current.user.id],
    );
    // Revoke the initiating session too: email verification is only an
    // initiation factor, never sufficient to continue using the account.
    await getPool().query("DELETE FROM \"session\" WHERE \"userId\" = $1", [current.user.id]);
    await recordAuditEvent({
      userId: current.user.id,
      actorType: "USER",
      actorId: current.user.id,
      type: "ACCOUNT_RECOVERY_INITIATED",
      message: "Verified email initiated account recovery; all sessions were revoked for manual review.",
    });
    await sendRecoveryNotice(current.user.email).catch((error) => {
      captureException(error, "ACCOUNT_RECOVERY_NOTIFICATION_FAILED", { userId: current.user.id });
    });
    return NextResponse.json({ ok: true, message: "Recovery is locked for manual review. All sessions were revoked; check your verified email for next steps." });
  } catch (error) {
    return rateLimitResponse(error) || NextResponse.json({ error: error instanceof Error ? error.message : "Could not start account recovery." }, { status: 400 });
  }
}
