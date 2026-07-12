import { NextResponse } from "next/server";
import { getPool, withTransaction } from "@/lib/db";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/http";
import { createUnsubscribeToken } from "@/lib/privacy";
import { getSiteUrl } from "@/lib/site";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_VERSION = "2026-07-mainnet-v1";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function sendWaitlistConfirmation(email: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new Error("Waitlist email delivery is not configured.");
  const unsubscribe = new URL("/unsubscribe", getSiteUrl());
  unsubscribe.searchParams.set("email", email);
  unsubscribe.searchParams.set("token", createUnsubscribeToken(email));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "You’re on the Rupi launch list",
      text: `You are on the Rupi launch list. You can unsubscribe at any time: ${unsubscribe.toString()}`,
    }),
    signal: AbortSignal.timeout(7_500),
  });
  if (!response.ok) throw new Error("Could not send waitlist confirmation.");
}

export async function GET() {
  try {
    const result = await getPool().query<{ metric_value: string }>(
      `SELECT metric_value::text FROM waitlist_metrics WHERE metric_key = 'active_count'`,
    );
    // This is a cached metric, never a public full-table count.
    return NextResponse.json({ count: Number(result.rows[0]?.metric_value || "0") }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "Could not load the waitlist." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "waitlist", limit: 4, windowSeconds: 60 * 60 });
    const body = await readJsonBody<{ email?: unknown; name?: unknown; source?: unknown; consent?: unknown; website?: unknown }>(request);
    // Honeypot: reply generically without storing automated submissions.
    if (String(body.website || "").trim()) return NextResponse.json({ ok: true });
    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const source = String(body.source || "landing_page").trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (name.length > 120 || source.length > 80) return NextResponse.json({ error: "One or more fields are too long." }, { status: 400 });
    if (body.consent !== true) return NextResponse.json({ error: "Consent to the privacy notice is required." }, { status: 400 });
    const result = await withTransaction(async (client) => {
      const existing = await client.query<{ unsubscribed_at: string | null; deletion_requested_at: string | null }>(
        `SELECT unsubscribed_at, deletion_requested_at FROM waitlist_signups WHERE email = $1 FOR UPDATE`,
        [email],
      );
      if (existing.rows[0]?.deletion_requested_at) {
        throw new Error("This email has a pending deletion request. Contact support to restore it.");
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO waitlist_signups (email, name, source, consent_version)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), waitlist_signups.name),
           source = EXCLUDED.source,
           consent_version = EXCLUDED.consent_version,
           consented_at = NOW(),
           unsubscribed_at = NULL
         RETURNING id`,
        [email, name || null, source || "landing_page", CONSENT_VERSION],
      );
      await client.query(
        `INSERT INTO consent_records (subject_email, consent_type, version, metadata)
         VALUES ($1, 'WAITLIST_MARKETING', $2, '{}'::jsonb)`,
        [email, CONSENT_VERSION],
      );
      const wasInactive = !existing.rows[0] || Boolean(existing.rows[0].unsubscribed_at);
      await client.query(
        `UPDATE waitlist_metrics SET metric_value = metric_value + $2, updated_at = NOW() WHERE metric_key = 'active_count'`,
        ["active_count", wasInactive ? 1 : 0],
      );
      const metric = await client.query<{ metric_value: string }>("SELECT metric_value::text FROM waitlist_metrics WHERE metric_key = 'active_count'");
      return { id: inserted.rows[0]?.id, count: Number(metric.rows[0]?.metric_value || "0") };
    });
    await sendWaitlistConfirmation(email);
    return NextResponse.json({ ok: true, count: result.count }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Cross-site request blocked.") {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
    return rateLimitResponse(error) || NextResponse.json({ error: error instanceof Error ? error.message : "Could not save waitlist signup." }, { status: 503 });
  }
}
