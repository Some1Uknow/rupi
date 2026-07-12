import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicPayment } from "@/lib/invoices";
import { createMetadata } from "@/lib/site";
import PayClient from "./PayClient";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const payment = await getPublicPayment(slug); if (!payment) return {};
  return createMetadata({ title: `Pay ${payment.invoice_number} · Rupi`, description: `Pay ${payment.expected_amount} ${payment.asset_code} on ${payment.network} for ${payment.invoice_number}.`, path: `/pay/${slug}` });
}

export default async function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const payment = await getPublicPayment(slug); if (!payment) notFound();
  const expired = payment.status === "EXPIRED";
  return <main className="rupi-pay-page"><div className="rupi-pay-wrap"><Link href="/" className="rupi-brand rupi-pay-brand"><img src="/brand-kit/rupi-logo.png" alt="" /><span>rupi</span></Link><section className="rupi-pay-card"><div className="rupi-pay-main"><p className="rupi-kicker">Rupi payment request</p><h1>{payment.invoice_number}</h1><p className="rupi-pay-description">{payment.description}</p><div className="rupi-pay-amount"><span>Amount due</span><strong>{Number(payment.expected_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 7 })} <small>USDC</small></strong></div><div className="rupi-pay-meta"><div><span>Network</span><strong>{payment.network}</strong></div><div><span>Memo required</span><strong>{expired ? "No longer active" : payment.payment_reference}</strong></div></div></div><aside className="rupi-pay-side"><h2>{expired ? "Payment link expired" : "Pay on Stellar"}</h2><p>{expired ? "This payment link can no longer receive an active payment. Ask the issuer for a new link." : "Use the exact USDC issuer and required memo. Rupi reconciles confirmed Mainnet payments in the background."}</p><PayClient slug={slug} initialStatus={payment.status} paymentUri={payment.payment_uri} address={payment.payment_address} memo={payment.payment_reference} /></aside></section></div></main>;
}
