import Link from "next/link";
import { ArrowUpRight, FilePlus2, WalletCards } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { listInvoices } from "@/lib/invoices";
import { getWallet, getWalletBalance } from "@/lib/wallets";
import { EmptyState, Money, PageHeader, StatusPill } from "@/components/product/Primitives";
import { ProvisionWalletButton } from "@/components/product/ProvisionWalletButton";

export default async function DashboardPage() {
  const user = await requireUser();
  const [invoices, wallet, balance, activity] = await Promise.all([
    listInvoices(user.id).catch(() => []),
    getWallet(user.id).catch(() => null),
    getWalletBalance(user.id).catch(() => null),
    listActivity(user.id, 5).catch(() => []),
  ]);
  const openInvoices = invoices.filter((invoice) => invoice.status !== "PAID").length;

  return (
    <main className="rupi-page">
      <PageHeader
        title="Overview"
        action={<Link className="rupi-button rupi-button-dark" href="/invoices/new"><FilePlus2 size={16} aria-hidden="true" />New payment link</Link>}
      />

      {!wallet || wallet.provision_status !== "READY" ? (
        <section className="rupi-surface rupi-wallet-setup">
          <div><h2>Set up your wallet</h2><p>Create a secure receiving address before you accept payments.</p></div>
          <ProvisionWalletButton />
        </section>
      ) : null}

      <section className="rupi-overview-grid">
        <article className="rupi-overview-balance">
          <div>
            <span>Available balance</span>
            <strong>{balance ? <Money value={balance.available} /> : "—"}</strong>
            <p>{balance ? "Ready to receive or cash out." : "Wallet balance is unavailable until custody activation completes."}</p>
          </div>
          <Link href="/balance" className="rupi-button rupi-button-light"><WalletCards size={15} aria-hidden="true" />View wallet</Link>
        </article>
        <aside className="rupi-overview-actions">
          <Link href="/invoices/new">
            <span>Payments</span>
            <strong>Create payment link <ArrowUpRight size={15} aria-hidden="true" /></strong>
            <small>{openInvoices ? `${openInvoices} open` : "No open requests"}</small>
          </Link>
          <Link href="/cashout">
            <span>Cash out</span>
            <strong>To INR <ArrowUpRight size={15} aria-hidden="true" /></strong>
            <small>Available after Onramp verification</small>
          </Link>
        </aside>
      </section>

      <section className="rupi-surface rupi-table-surface">
        <div className="rupi-surface-header"><div><h2>Recent activity</h2></div><Link href="/transactions" className="rupi-link">View all</Link></div>
        {activity.length === 0 ? <EmptyState title="Your ledger is quiet" body="When an invoice is paid or you start a cash-out, it will appear here." /> : <>
          <div className="rupi-table-head"><span>Type</span><span>Details</span><span>When</span><span>Amount</span><span>Status</span></div>
          {activity.map((item) => <div className="rupi-row" key={item.id}><span>{item.kind.replaceAll("_", " ")}</span><div className="rupi-row-primary"><strong>{item.direction === "IN" ? "Received into Rupi" : "Sent from Rupi"}</strong><small>{item.memo || item.transaction_hash.slice(0, 16)}</small></div><span>{new Date(item.occurred_at).toLocaleDateString()}</span><strong>{item.direction === "OUT" ? "−" : "+"}<Money value={item.amount} /></strong><StatusPill status={item.status} /></div>)}
        </>}
      </section>
    </main>
  );
}
