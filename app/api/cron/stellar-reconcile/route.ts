import { NextResponse } from "next/server";
import { expireInvoices, reconcilePendingPayments } from "@/lib/invoices";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorized = configuredSecret && request.headers.get("authorization") === `Bearer ${configuredSecret}`;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const expired = await expireInvoices();
  const results = await reconcilePendingPayments();
  return NextResponse.json({ expired, checked: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
