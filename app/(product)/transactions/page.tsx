import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { explorerTransactionUrl } from "@/lib/stellar";
import { EmptyState, Money, PageHeader, StatusPill } from "@/components/product/Primitives";

export default async function TransactionsPage() {
  const user = await requireUser();
  const activity = await listActivity(user.id).catch(() => []);
  return <main className="rupi-page">
    <PageHeader title="Activity" />
    <section className="rupi-surface rupi-table-surface">
      <div className="rupi-surface-header"><div><h2>All activity</h2></div><span className="rupi-status rupi-status-active">{activity.length} confirmed</span></div>
      {activity.length === 0 ? <EmptyState title="No transactions yet" body="Create a payment link or set up your wallet to begin recording activity." /> : <>
        <div className="rupi-table-head"><span>Type</span><span>Transaction</span><span>When</span><span>Amount</span><span>Status</span></div>
        {activity.map((item) => <div className="rupi-row" key={item.id}>
          <span>{item.kind.replaceAll("_", " ")}</span>
          <div className="rupi-row-primary"><strong>{item.direction === "IN" ? "Incoming" : "Outgoing"} USDC</strong><a className="rupi-link rupi-hash" href={explorerTransactionUrl(item.transaction_hash)} target="_blank" rel="noreferrer">{item.transaction_hash.slice(0, 13)}… <ExternalLink size={11} /></a></div>
          <span>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.occurred_at))}</span>
          <strong>{item.direction === "OUT" ? "−" : "+"}<Money value={item.amount} /></strong>
          <StatusPill status={item.status} />
        </div>)}
      </>}
    </section>
  </main>;
}
