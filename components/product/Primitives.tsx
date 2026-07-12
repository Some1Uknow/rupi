import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="rupi-page-header">
      <div>
        <h1>{title}</h1>
      </div>
      {action ? <div className="rupi-page-action">{action}</div> : null}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll("_", "-");
  return <span className={`rupi-status rupi-status-${normalized}`}>{status.replaceAll("_", " ")}</span>;
}

export function Money({ value, currency = "USDC", compact = false }: { value: string | number; currency?: string; compact?: boolean }) {
  const amount = Number(value || 0);
  const label = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: compact ? 2 : 2,
    maximumFractionDigits: compact ? 2 : 7,
  }).format(Number.isFinite(amount) ? amount : 0);
  return <span className="rupi-money">{label}{currency ? <small>{currency}</small> : null}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return <div className="rupi-empty"><div className="rupi-empty-mark">✦</div><strong>{title}</strong><p>{body}</p>{action ? <Link className="rupi-button rupi-button-dark" href={action.href}>{action.label}</Link> : null}</div>;
}

export function ShortAddress({ address }: { address: string }) {
  if (address.length < 16) return <>{address}</>;
  return <>{address.slice(0, 7)}…{address.slice(-6)}</>;
}
