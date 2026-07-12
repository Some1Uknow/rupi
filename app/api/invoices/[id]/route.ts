import { NextResponse } from "next/server";
import { getPasskeyAssuredUser } from "@/lib/auth";
import { getInvoice } from "@/lib/invoices";
import { isProductAppEnabled } from "@/lib/flags";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isProductAppEnabled()) {
    return NextResponse.json({ error: "Product app is not enabled." }, { status: 404 });
  }

  const user = await getPasskeyAssuredUser();
  if (!user) return NextResponse.json({ error: "Passkey verification required." }, { status: 401 });
  const { id } = await params;
  const invoice = await getInvoice(id, user.id);

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  return NextResponse.json({ invoice });
}
