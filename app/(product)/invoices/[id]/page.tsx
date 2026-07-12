import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getInvoice } from "@/lib/invoices";
import { explorerTransactionUrl } from "@/lib/stellar";
import { getSiteUrl } from "@/lib/site";
import { CopyButton } from "@/components/product/CopyButton";
import { Money, PageHeader, ShortAddress, StatusPill } from "@/components/product/Primitives";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params;
  const invoice = await getInvoice(id, user.id); if (!invoice) notFound();
  const intent = invoice.payment_intent; const payLink = `${getSiteUrl()}/pay/${intent.slug}`;
  const paymentEvent = invoice.audit_events.find((event: { type: string }) => event.type === "PAYMENT_DETECTED");
  const transactionHash = paymentEvent?.metadata?.transactionHash as string | undefined;
  return <main className="rupi-page">
    <PageHeader title={invoice.client_name} action={<Link href={`/pay/${intent.slug}`} target="_blank" className="rupi-button rupi-button-dark">Open payment page <ArrowUpRight size={15} /></Link>} />
    <section className="rupi-invoice-summary"><div><span>Amount</span><strong><Money value={invoice.amount} /></strong></div><div><span>Status</span><StatusPill status={invoice.status} /></div></section>
    <section className="rupi-split rupi-invoice-detail-grid"><article className="rupi-surface"><div className="rupi-surface-header"><div><h2>Payment details</h2></div></div><div className="rupi-detail-grid"><div className="rupi-detail-cell"><span>Payment page</span><strong>{payLink}</strong><CopyButton value={payLink} label="Copy link" /></div><div className="rupi-detail-cell"><span>Address</span><strong><ShortAddress address={intent.payment_address} /></strong><CopyButton value={intent.payment_address} label="Copy address" /></div><div className="rupi-detail-cell"><span>Memo</span><strong>{intent.payment_reference}</strong><CopyButton value={intent.payment_reference} label="Copy memo" /></div><div className="rupi-detail-cell"><span>Amount</span><strong><Money value={invoice.amount} /></strong></div></div></article><aside className="rupi-surface"><div className="rupi-surface-header"><div><h2>Timeline</h2></div></div><div className="rupi-progress">{invoice.audit_events.map((event: { id: string; type: string; message: string; created_at: string }) => <div className="rupi-progress-step is-done" key={event.id}><span className="rupi-progress-dot">✓</span><div><strong>{event.type.replaceAll("_", " ")}</strong><p>{event.message}</p></div></div>)}</div></aside></section>
    {transactionHash ? <a href={explorerTransactionUrl(transactionHash)} target="_blank" rel="noreferrer" className="rupi-confirmed-transaction">Payment confirmed on Stellar Explorer <ExternalLink size={14} /></a> : null}
  </main>;
}
