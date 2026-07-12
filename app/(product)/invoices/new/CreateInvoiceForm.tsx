"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

export default function CreateInvoiceForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(formData: FormData) {
    setError(""); setLoading(true);
    const amount = String(formData.get("amount") || "");
    const description = String(formData.get("description") || "");
    try {
      const response = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ clientName: String(formData.get("clientName") || ""), clientEmail: String(formData.get("clientEmail") || ""), clientCountry: String(formData.get("clientCountry") || ""), description, dueDate: String(formData.get("dueDate") || ""), purposeCode: String(formData.get("purposeCode") || "P0802"), lineItems: [{ description, qty: "1", rate: amount }] }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create the invoice.");
      router.push(`/invoices/${body.invoice.id}`); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the invoice."); } finally { setLoading(false); }
  }

  return <form action={submit} className="rupi-form">
    <div className="rupi-form-grid"><label><span>Client name</span><input name="clientName" autoComplete="organization" placeholder="Acme Studios" required /></label><label><span>Client email <em>optional</em></span><input name="clientEmail" type="email" autoComplete="email" placeholder="billing@acme.com" /></label><label><span>Client country</span><input name="clientCountry" defaultValue="US" autoComplete="country-name" /></label><label><span>Amount · USDC</span><input name="amount" inputMode="decimal" placeholder="1,250.0000000" required /></label><label className="wide"><span>What is this for?</span><textarea name="description" rows={4} placeholder="Product design and implementation — July milestone" required /></label><label><span>Due date <em>optional</em></span><input name="dueDate" type="date" /></label><label><span>Purpose code</span><select name="purposeCode" defaultValue="P0802"><option value="P0802">P0802 — Software consultancy</option><option value="P0806">P0806 — IT enabled services</option><option value="P1006">P1006 — Business consultancy</option></select></label></div>
    {error ? <p className="rupi-form-error">{error}</p> : null}
    <div className="rupi-form-actions"><button type="submit" className="rupi-button rupi-button-dark" disabled={loading}>{loading ? <><LoaderCircle size={15} className="rupi-spin" />Creating payment link…</> : <>Create payment link <ArrowRight size={15} /></>}</button><span className="rupi-form-note">Each link gets its own Stellar memo for exact matching.</span></div>
  </form>;
}
