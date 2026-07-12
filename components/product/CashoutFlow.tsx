"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";

type Beneficiary = { id: string; bank_name: string; account_last4: string } | null;
type Config = {
  available: boolean;
  kycState: string;
  providerAvailable: boolean;
  beneficiary: { bankName: string; accountLast4: string } | null;
  caps: { perTransactionInr: string; rolling24hInr: string; rupiFeeBps: number };
};
type Quote = {
  id: string;
  amount: string;
  grossInr: string;
  onrampFeeInr: string;
  gatewayFeeInr: string;
  tdsInr: string;
  rupiFeeInr: string;
  netInr: string;
  expiresAt: string;
};
type Order = {
  id: string;
  amount: string;
  gross_inr: string;
  net_inr: string;
  state: string;
  transaction_hash: string | null;
  created_at: string;
  recovery: string | null;
};

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function toBase64Url(value: ArrayBuffer | null) {
  if (!value) return undefined;
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function authenticationOptions(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64Url(String(options.challenge)),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((credential) => ({ ...(credential as PublicKeyCredentialDescriptor), id: fromBase64Url(String((credential as Record<string, unknown>).id)) }))
      : undefined,
  };
}

function authenticationResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: toBase64Url(response.userHandle),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

async function passkeyStepUp({ action, amount, idempotencyKey }: { action: "CASHOUT" | "BENEFICIARY_CHANGE"; amount?: string; idempotencyKey: string }) {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error("This browser does not support passkey authorization.");
  const optionsResponse = await fetch("/api/auth/step-up/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, amount, idempotencyKey }),
  });
  const optionsBody = await optionsResponse.json().catch(() => ({}));
  if (!optionsResponse.ok) throw new Error(optionsBody.error || "Could not start passkey authorization.");
  const credential = await navigator.credentials.get({ publicKey: authenticationOptions(optionsBody.options as Record<string, unknown>) });
  if (!credential || !(credential instanceof PublicKeyCredential)) throw new Error("Passkey authorization was cancelled.");
  const verify = await fetch("/api/auth/step-up/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: authenticationResponse(credential) }),
  });
  const verified = await verify.json().catch(() => ({}));
  if (!verify.ok || !verified.authorization?.token) throw new Error(verified.error || "Could not verify passkey authorization.");
  return String(verified.authorization.token);
}

export function CashoutFlow({
  initialBeneficiary,
  initialOrders,
  initialConfig,
}: {
  initialBeneficiary: Beneficiary;
  initialOrders: Order[];
  initialConfig: Config;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeOrder = initialOrders.find((order) => !["PAID", "EXPIRED", "REJECTED", "AMOUNT_MISMATCH", "REFUNDED"].includes(order.state));

  useEffect(() => {
    if (!activeOrder) return;
    const interval = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [activeOrder, router]);

  async function openKyc() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cashout/kyc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: "/cashout" }) });
      const body = await response.json();
      if (!response.ok || !body.hostedUrl) throw new Error(body.error || "Could not start verification.");
      window.location.assign(body.hostedUrl);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start verification."); setLoading(false); }
  }

  async function openBeneficiary() {
    setLoading(true); setError("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const stepUpToken = await passkeyStepUp({ action: "BENEFICIARY_CHANGE", idempotencyKey });
      const response = await fetch("/api/cashout/beneficiary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: "/cashout", idempotencyKey, stepUpToken }) });
      const body = await response.json();
      if (!response.ok || !body.hostedUrl) throw new Error(body.error || "Could not start secure bank setup.");
      window.location.assign(body.hostedUrl);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start secure bank setup."); setLoading(false); }
  }

  async function getQuote() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cashout/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not get a quote.");
      setQuote(body.quote);
      setOrderIdempotencyKey(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not get a quote."); } finally { setLoading(false); }
  }

  async function confirmCashout() {
    if (!quote) return;
    setLoading(true); setError("");
    const idempotencyKey = orderIdempotencyKey || crypto.randomUUID();
    if (!orderIdempotencyKey) setOrderIdempotencyKey(idempotencyKey);
    try {
      const stepUpToken = await passkeyStepUp({ action: "CASHOUT", amount: quote.amount, idempotencyKey });
      const response = await fetch("/api/cashout/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ quoteId: quote.id, stepUpToken }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not submit cash-out.");
      setQuote(null); setAmount(""); setOrderIdempotencyKey(null); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not submit cash-out."); } finally { setLoading(false); }
  }

  const needsKyc = initialConfig.kycState !== "APPROVED";
  const canQuote = initialConfig.available && !activeOrder;
  return <div className="rupi-section-stack">
    <section className="rupi-surface">
      <div className="rupi-invoice-top"><div><h2>INR cash-out</h2><p>Processed by Onramp. Rupi stores only provider references and masked bank details.</p></div></div>
      <div className="rupi-detail-grid"><div className="rupi-detail-cell"><span>Per cash-out</span><strong>₹{initialConfig.caps.perTransactionInr}</strong></div><div className="rupi-detail-cell"><span>Rolling 24 hours</span><strong>₹{initialConfig.caps.rolling24hInr}</strong></div><div className="rupi-detail-cell"><span>Rupi fee</span><strong>{initialConfig.caps.rupiFeeBps / 100}%</strong></div></div>
      {needsKyc ? <div className="rupi-form"><p>Complete verification with Onramp before bank settlement is enabled.</p><button className="rupi-button rupi-button-dark" type="button" onClick={openKyc} disabled={loading}>{loading ? "Opening verification…" : <><ShieldCheck size={15} />Verify with Onramp</>}</button></div> : !initialBeneficiary ? <div className="rupi-form"><p>Your verification is approved. Add a bank account directly in Onramp’s secure flow.</p><button className="rupi-button rupi-button-dark" type="button" onClick={openBeneficiary} disabled={loading}>{loading ? "Opening secure setup…" : "Add bank account"}</button></div> : <div className="rupi-form"><p>{initialBeneficiary.bank_name} · •••• {initialBeneficiary.account_last4}</p>{!initialConfig.providerAvailable ? <p className="rupi-form-error">Onramp configuration is unavailable. Cash-out is paused until it is verified again.</p> : activeOrder ? <p className="rupi-form-error">An existing cash-out is being reconciled. Do not send another transfer.</p> : <><label><span>Amount · USDC</span><input value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} inputMode="decimal" placeholder="0.0000000" /></label><button className="rupi-button rupi-button-dark" type="button" onClick={getQuote} disabled={loading || !amount || !canQuote}>{loading ? <><LoaderCircle size={15} className="rupi-spin" />Getting signed quote…</> : <>Review quote <ArrowRight size={15} /></>}</button></>}</div>}
      {error ? <p className="rupi-form-error">{error}</p> : null}
    </section>
    {quote ? <section className="rupi-surface rupi-quote-card"><div><span>Sending</span><strong>{quote.amount} USDC</strong></div><div><span>Gross INR</span><strong>₹{quote.grossInr}</strong></div><div><span>Onramp fee</span><strong>₹{quote.onrampFeeInr}</strong></div><div><span>Gateway fee</span><strong>₹{quote.gatewayFeeInr}</strong></div><div><span>TDS</span><strong>₹{quote.tdsInr}</strong></div><div><span>Rupi fee (0.5%)</span><strong>₹{quote.rupiFeeInr}</strong></div><div><span>You receive</span><strong>₹{quote.netInr}</strong></div><p>Quote expires {new Date(quote.expiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Confirming opens your passkey; the exact quoted amount and this request are bound to that authorization.</p><button className="rupi-button rupi-button-lime" type="button" onClick={confirmCashout} disabled={loading}>{loading ? "Authorizing…" : "Authorize and submit"}</button></section> : null}
    {initialOrders.length ? <section className="rupi-surface"><div className="rupi-surface-header"><div><h2>Cash-out status</h2><p>Provider-verified progress</p></div></div><div className="rupi-progress">{initialOrders.map((order) => <div className="rupi-order-block" key={order.id}><div className="rupi-order-top"><strong>{order.amount} USDC → ₹{order.net_inr}</strong><span>{order.state.replaceAll("_", " ")}</span></div><div className="rupi-progress-step is-done"><span className="rupi-progress-dot">✓</span><div><strong>Cash-out</strong><p>{order.recovery || (order.transaction_hash ? `Stellar transaction ${order.transaction_hash.slice(0, 14)}…` : "Awaiting the settlement provider.")}</p></div></div></div>)}</div></section> : null}
  </div>;
}
