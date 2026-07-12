import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, ShieldCheck, Sparkles } from "lucide-react";

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page auth-page--split">
      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-form-brand" aria-label="Rupi">
            <Image src="/brand-kit/rupi-logo.png" alt="" width={44} height={44} priority />
            <span>rupi</span>
          </div>
          {children}
          <p className="auth-legal">
            By continuing, you agree to Rupi&apos;s <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Notice</Link>.
          </p>
        </div>
      </section>

      <aside className="auth-brand-panel" aria-label="About Rupi">
        <div className="auth-brand-orbit auth-brand-orbit--large" aria-hidden="true" />
        <div className="auth-brand-orbit auth-brand-orbit--small" aria-hidden="true" />
        <div className="auth-brand-content">
          <div className="auth-brand-lockup">
            <Image src="/brand-kit/rupi-logo.png" alt="" width={40} height={40} priority />
            <span>rupi</span>
          </div>

          <div className="auth-brand-copy">
            <p className="auth-brand-kicker"><Sparkles size={14} aria-hidden="true" /> Built for the payment path</p>
            <h2>Invoice globally.<br /><em>Settle with clarity.</em></h2>
            <p>Rupi helps verified Indian professionals receive USDC on Stellar and follow every step through to INR settlement.</p>
          </div>

          <section className="auth-trust-card" aria-label="Rupi security details">
            <p className="auth-trust-quote">“No seed phrases. No shadow balances.”</p>
            <p>Rupi keeps the path clear: managed custody, unique payment references, and explicit settlement states.</p>
            <div className="auth-trust-foot">
              <span className="auth-trust-mark"><ShieldCheck size={17} aria-hidden="true" /></span>
              <span><strong>Security by design</strong><small>Passkey protection for fund movement</small></span>
            </div>
          </section>

          <div className="auth-proof-row" aria-label="Rupi payment infrastructure">
            <span><BadgeCheck size={16} aria-hidden="true" /> Stellar Mainnet</span>
            <span>Fireblocks custody</span>
            <span>INR settlement</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
