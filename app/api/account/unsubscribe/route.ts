import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/privacy";
import { readJsonBody } from "@/lib/http";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonBody<{ email?: unknown; token?: unknown }>(request);
    const email = String(body.email || "").trim().toLowerCase();
    const token = String(body.token || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !verifyUnsubscribeToken(token, email)) {
      return NextResponse.json({ error: "Invalid unsubscribe link." }, { status: 400 });
    }
    await withTransaction(async (client) => {
      const result = await client.query<{ unsubscribed_at: string | null }>(
        "SELECT unsubscribed_at FROM waitlist_signups WHERE email = $1 FOR UPDATE",
        [email],
      );
      if (result.rows[0] && !result.rows[0].unsubscribed_at) {
        await client.query("UPDATE waitlist_signups SET unsubscribed_at = NOW() WHERE email = $1", [email]);
        await client.query("UPDATE waitlist_metrics SET metric_value = GREATEST(0, metric_value - 1), updated_at = NOW() WHERE metric_key = 'active_count'");
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Cross-site request blocked.") {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not update subscription preferences." }, { status: 503 });
  }
}
