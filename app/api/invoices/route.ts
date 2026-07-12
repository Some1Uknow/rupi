import { NextResponse } from "next/server";
import { createInvoice, listInvoices } from "@/lib/invoices";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { isProductAppEnabled } from "@/lib/flags";
import { apiError, readJsonBody } from "@/lib/http";
import { enforceRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { assertSameOrigin } from "@/lib/csrf";

export const runtime = "nodejs";

export async function GET() {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }

  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const invoices = await listInvoices(user.id);
  return NextResponse.json({ invoices });
}

export async function POST(request: Request) {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }

  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required." }, { status: 400 });
  try {
    assertSameOrigin(request);
    await enforceRateLimit({ request, namespace: "invoices:create", limit: 20, windowSeconds: 10 * 60, subject: user.id });
  } catch (error) {
    return rateLimitResponse(error) || NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try { body = await readJsonBody<Record<string, unknown>>(request); }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  try {
    const result = await createInvoice(body, user.id, idempotencyKey);
    return NextResponse.json({
      invoice: result.invoice,
      paymentIntent: result.payment_intent,
      payLink: `/pay/${result.payment_intent.slug}`,
    });
  } catch (error) {
    return rateLimitResponse(error) || apiError(error, "Could not create invoice.");
  }
}
