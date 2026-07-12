import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { syncOnrampConfiguration, reconcilePendingKycStatuses, reconcileProviderOrders } from "@/lib/cashout";
import { processPendingProviderEvents } from "@/lib/provider-events";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const snapshot = await getPool().query<{ fetched_at: string }>("SELECT fetched_at FROM onramp_configuration_snapshots ORDER BY fetched_at DESC LIMIT 1");
  let configuration = "fresh";
  if (!snapshot.rows[0] || Date.parse(snapshot.rows[0].fetched_at) < Date.now() - 24 * 60 * 60_000) {
    await syncOnrampConfiguration();
    configuration = "synced";
  }
  const [events, orders, kyc] = await Promise.all([processPendingProviderEvents(), reconcileProviderOrders(), reconcilePendingKycStatuses()]);
  return NextResponse.json({ configuration, events: events.length, orders: orders.length, kyc: kyc.length }, { headers: { "Cache-Control": "no-store" } });
}
