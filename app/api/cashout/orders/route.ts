import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { createCashoutOrder, listCashoutOrders } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";
import { apiError, readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json({ orders: await listCashoutOrders(user.id) });
}

export async function POST(request: Request) {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required." }, { status: 400 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "cashout:orders", limit: 5, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ quoteId?: unknown; stepUpToken?: unknown }>(request);
    const order = await createCashoutOrder({
      userId: user.id,
      quoteId: String(body.quoteId || ""),
      idempotencyKey,
      stepUpToken: String(body.stepUpToken || ""),
    });
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not start cash-out.");
  }
}
