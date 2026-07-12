import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listInvoices } from "@/lib/invoices";
import { EmptyState, Money, PageHeader, StatusPill } from "@/components/product/Primitives";

export default async function InvoicesPage() {
  const user = await requireUser();
  const invoices = await listInvoices(user.id).catch(() => []);
  return <main className="rupi-page">
    <PageHeader title="Payments" action={<Link href="/invoices/new" className="rupi-button rupi-button-dark"><FilePlus2 size={16} />New payment link</Link>} />
    <section className="rupi-surface rupi-table-surface"><div className="rupi-surface-header"><div><h2>All requests</h2><p>{invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} in this account` : "Nothing sent yet"}</p></div></div>{invoices.length === 0 ? <EmptyState title="Create your first payment link" body="Start with a client, the amount due, and a short description. Rupi will handle the Stellar payment instructions." action={{ href: "/invoices/new", label: "Create payment link" }} /> : <><div className="rupi-table-head"><span>Invoice</span><span>Client</span><span>Due</span><span>Amount</span><span>Status</span></div>{invoices.map((invoice) => <Link href={`/invoices/${invoice.id}`} className="rupi-row" key={invoice.id}><span>{invoice.invoice_number}</span><div className="rupi-row-primary"><strong>{invoice.client_name}</strong><small>{invoice.description}</small></div><span>{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "No due date"}</span><strong><Money value={invoice.amount} /></strong><StatusPill status={invoice.status} /></Link>)}</>}</section>
  </main>;
}
