import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <main className="auth-page"><article className="auth-card legal-card"><Link href="/" className="rupi-link">← Rupi</Link>{children}<p className="muted">Document version: 2026-07-mainnet-v1. These launch documents require final Indian legal and compliance approval before Mainnet cash-out is enabled.</p></article></main>;
}
