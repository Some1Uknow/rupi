"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  FileText,
  LayoutDashboard,
  Menu,
  Settings,
  WalletCards,
  X,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/invoices", label: "Payments", icon: FileText },
  { href: "/transactions", label: "Activity", icon: ArrowLeftRight },
  { href: "/balance", label: "Wallet", icon: WalletCards },
  { href: "/cashout", label: "Cash out", icon: ArrowDownToLine },
];

function isCurrent(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function ProductNav({ user }: { user: { name?: string | null; email?: string | null } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const displayName = user.name || "Rupi member";

  const links = (mobile = false) => navItems.map(({ href, label, icon: Icon }) => (
    <Link
      href={href}
      key={href}
      className={isCurrent(pathname, href) ? "is-active" : ""}
      aria-current={isCurrent(pathname, href) ? "page" : undefined}
      onClick={() => mobile && setOpen(false)}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  ));

  return (
    <>
      <aside className="rupi-rail">
        <Link href="/dashboard" className="rupi-brand" aria-label="Rupi home">
          <img src="/brand-kit/rupi-logo.png" alt="" />
          <span>rupi</span>
        </Link>
        <nav className="rupi-nav" aria-label="Product navigation">{links()}</nav>
        <div className="rupi-rail-foot">
          <Link href="/settings" className={isCurrent(pathname, "/settings") ? "is-active rupi-settings-link" : "rupi-settings-link"}>
            <Settings size={17} aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link href="/settings" className="rupi-user-summary">
            <span className="rupi-user-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{displayName}</strong>
              <span>Account</span>
            </div>
          </Link>
        </div>
      </aside>

      <header className="rupi-mobile-header">
        <Link href="/dashboard" className="rupi-brand" aria-label="Rupi home">
          <img src="/brand-kit/rupi-logo.png" alt="" />
          <span>rupi</span>
        </Link>
        <button className="rupi-menu-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="rupi-mobile-nav">
          {open ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          <span className="sr-only">Toggle navigation</span>
        </button>
        {open ? <nav id="rupi-mobile-nav" className="rupi-mobile-nav" aria-label="Product navigation">{links(true)}<Link href="/settings" onClick={() => setOpen(false)}><Settings size={18} aria-hidden="true" /><span>Settings</span></Link></nav> : null}
      </header>
    </>
  );
}

export function NetworkNotice() {
  return null;
}
