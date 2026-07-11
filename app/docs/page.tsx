import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BookOpenText, ExternalLink, Globe2, Landmark, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { CopyButton } from "@/components/product/CopyButton";
import { createMetadata } from "@/lib/site";
import { formContractAddresses, testnetContracts } from "@/lib/docs";

export const metadata = createMetadata({
  title: "Rupi Docs — Stellar Testnet integration guide",
  description: "Rupi Testnet product documentation, contract addresses, product flows, and integration notes.",
  path: "/docs",
});

const sections = [
  ["Start here", "What Rupi does"],
  ["Testnet", "Contract addresses"],
  ["Flows", "Invoices, Yield, Cash out"],
  ["For agents", "Markdown and llms.txt"],
] as const;

export default function DocsPage() {
  return (
    <main className="docs-page">
      <header className="docs-topbar">
        <Link href="/" className="docs-brand" aria-label="Rupi home">
          <img src="/brand-kit/rupi-logo.png" alt="" />
          <span>Rupi</span>
        </Link>
        <nav aria-label="Documentation utilities">
          <a href="/llms.txt">llms.txt</a>
          <a href="/llms-full.txt">LLM full text</a>
          <Link href="/">Back to site <ArrowUpRight size={15} /></Link>
        </nav>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar">
          <p>Documentation</p>
          {sections.map(([label, detail], index) => <a href={`#section-${index}`} key={label}><span>{label}</span><small>{detail}</small></a>)}
          <div className="docs-sidebar-note"><ShieldCheck size={16} /><span>Testnet only. No real INR payout is sent.</span></div>
        </aside>

        <article className="docs-article">
          <Link className="docs-back" href="/"><ArrowLeft size={15} />Rupi home</Link>
          <div className="docs-eyebrow"><span />Stellar Testnet · Product docs</div>
          <h1>Move from invoice<br />to INR, clearly.</h1>
          <p className="docs-lede">Rupi lets global freelancers invoice in dollars, receive Stellar USDC, choose optional Blend yield, and start an INR cash-out from one ledger.</p>
          <div className="docs-actions"><a href="#section-1">View Testnet addresses <ArrowDown /></a><a className="docs-text-action" href="/docs/addresses.md">Read as Markdown <ExternalLink size={15} /></a></div>

          <section id="section-0" className="docs-section docs-start-section">
            <div className="docs-section-heading"><span>01</span><div><p>Start here</p><h2>One account. Four moments.</h2></div></div>
            <div className="docs-flow-grid">
              <div><BookOpenText size={20}/><strong>Invoice</strong><p>Create a USD payment request with a unique Stellar memo.</p></div>
              <div><WalletCards size={20}/><strong>Receive</strong><p>Watch Testnet USDC settle to the linked Stellar wallet.</p></div>
              <div><Sparkles size={20}/><strong>Yield</strong><p>Manually supply idle USDC to Blend—never automatically.</p></div>
              <div><Landmark size={20}/><strong>Cash out</strong><p>Review an INR quote, choose a bank, and begin the flow.</p></div>
            </div>
          </section>

          <section id="section-1" className="docs-section">
            <div className="docs-section-heading"><span>02</span><div><p>Testnet</p><h2>Smart contract addresses</h2></div></div>
            <div className="docs-callout"><Globe2 size={18}/><div><strong>What to paste into the form</strong><p>Enter the Blend Pool V2 and Blend Testnet USDC token contract IDs below. Rupi does not deploy a separate custom smart contract in this MVP.</p></div></div>
            <div className="docs-address-stack">
              {[testnetContracts.blendPool, testnetContracts.usdcToken, testnetContracts.usdcIssuer].map((entry, index) => <div className="docs-address-card" key={entry.label}>
                <div className="docs-address-meta"><span>{index < 2 ? "SOROBAN CONTRACT" : "CLASSIC ASSET ISSUER"}</span><strong>{entry.label}</strong><p>{entry.detail}</p></div>
                <code>{entry.value}</code>
                <CopyButton value={entry.value} label="Copy" />
              </div>)}
            </div>
            <div className="docs-form-answer"><span>Form-ready value</span><code>{formContractAddresses.join(", ")}</code><CopyButton value={formContractAddresses.join(", ")} label="Copy both" /></div>
          </section>

          <section id="section-2" className="docs-section">
            <div className="docs-section-heading"><span>03</span><div><p>Flows</p><h2>What happens on-chain</h2></div></div>
            <div className="docs-prose-grid">
              <div><h3>Invoices</h3><p>The payment link encodes the configured Testnet USDC asset, destination wallet and invoice memo. Horizon reconciliation marks confirmed payments paid.</p></div>
              <div><h3>Yield</h3><p>Deposit and withdraw actions submit explicit requests to Blend Pool V2. Rupi reads the position; it never moves a user’s funds without confirmation.</p></div>
              <div><h3>Cash out</h3><p>Rupi submits a real Testnet USDC transfer to a configured sink account. The INR quote and payout stages are simulation-only in this MVP.</p></div>
            </div>
          </section>

          <section id="section-3" className="docs-section docs-agent-section">
            <div className="docs-section-heading"><span>04</span><div><p>For agents</p><h2>Readable by humans and models.</h2></div></div>
            <p>Use the canonical text versions when an LLM, agent, or integration needs structured context without navigating the visual site.</p>
            <div className="docs-agent-links"><a href="/llms.txt">/llms.txt <ArrowUpRight size={15}/></a><a href="/llms-full.txt">/llms-full.txt <ArrowUpRight size={15}/></a><a href="/docs/addresses.md">/docs/addresses.md <ArrowUpRight size={15}/></a></div>
          </section>
        </article>
      </div>
    </main>
  );
}

function ArrowDown() {
  return <span aria-hidden="true">↓</span>;
}
