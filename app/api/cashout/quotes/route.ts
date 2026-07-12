import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { createCashoutQuote } from "@/lib/cashout";
import { isProductAppEnabled } from "@/lib/flags";
import { apiError, readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isProductAppEnabled()) return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "cashout:quotes", limit: 8, windowSeconds: 10 * 60, subject: user.id });
    const body = await readJsonBody<{ amount?: unknown }>(request);
    const quote = await createCashoutQuote({ userId: user.id, amount: String(body.amount || "") });
    return NextResponse.json({ quote }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not create cash-out quote.", 503);
  }
}
