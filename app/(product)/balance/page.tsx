import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getWallet, getWalletBalance } from "@/lib/wallets";
import { Money, PageHeader } from "@/components/product/Primitives";
import { ProvisionWalletButton } from "@/components/product/ProvisionWalletButton";
import { WalletCard } from "@/components/product/WalletCard";

export default async function BalancePage() {
  const user = await requireUser();
  const [wallet, balance] = await Promise.all([
    getWallet(user.id).catch(() => null),
    getWalletBalance(user.id).catch(() => null),
  ]);
  return <main className="rupi-page">
    <PageHeader title="Wallet" />
    {!wallet || wallet.provision_status !== "READY" ? <section className="rupi-surface rupi-wallet-setup"><div><p className="rupi-kicker">Wallet required</p><h2>Set up your receiving account</h2><p>Rupi creates a Fireblocks-managed Stellar Mainnet receiving address after custody activation.</p></div><ProvisionWalletButton /></section> : <>
      <section className="rupi-balance-grid">
        <article className="rupi-surface rupi-balance-summary"><span>Available</span><strong>{balance ? <Money value={balance.available} /> : "—"}</strong><p>{balance ? "Liquid USDC" : "Custody balance unavailable"}</p><div><Link href="/invoices/new" className="rupi-button rupi-button-dark">Request payment <ArrowRight size={15} /></Link><Link href="/cashout" className="rupi-button rupi-button-light"><Landmark size={15} />Cash out</Link></div></article>
        <article className="rupi-surface rupi-deployed-summary"><span>Custody</span><strong>Fireblocks</strong><p>Rupi does not hold or decrypt your Stellar signing key.</p></article>
      </section>
      {balance ? <WalletCard address={balance.address} issuer={balance.assetIssuer} /> : null}
    </>}
  </main>;
}
