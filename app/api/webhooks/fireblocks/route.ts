import { NextResponse } from "next/server";
import { fireblocks } from "@/lib/providers/fireblocks";
import { enqueueProviderEvent, logWebhookAccepted } from "@/lib/provider-events";
import { isFreshWebhookTimestamp, parseProviderTimestamp } from "@/lib/providers/webhook";
import { RequestBodyTooLargeError, readRawBody } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await readRawBody(request, 256_000);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "Payload too large." : "Invalid webhook payload." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const signature = request.headers.get("x-fireblocks-signature");
  const timestamp = request.headers.get("x-fireblocks-timestamp");
  if (!fireblocks.verifyWebhook(rawBody, signature, timestamp) || !isFreshWebhookTimestamp(timestamp)) {
    return NextResponse.json({ error: "Invalid webhook." }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  try {
    const event = await enqueueProviderEvent({
      provider: "FIREBLOCKS",
      rawBody,
      payload,
      signatureTimestamp: parseProviderTimestamp(timestamp),
      eventId: request.headers.get("x-fireblocks-event-id") || request.headers.get("x-event-id"),
    });
    logWebhookAccepted("FIREBLOCKS", event.accepted);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Webhook queue unavailable." }, { status: 503 });
  }
}
