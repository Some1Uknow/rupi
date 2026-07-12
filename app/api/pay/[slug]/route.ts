import { NextResponse } from "next/server";
import { getPublicPayment } from "@/lib/invoices";
import { isProductAppEnabled } from "@/lib/flags";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }

  const { slug } = await params;
  const payment = await getPublicPayment(slug);

  if (!payment) {
    return NextResponse.json({ error: "Payment link not found." }, { status: 404 });
  }

  return NextResponse.json({ payment }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
