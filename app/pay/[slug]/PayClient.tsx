"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { CopyButton } from "@/components/product/CopyButton";

export default function PayClient({
  slug,
  initialStatus,
  paymentUri,
  address,
  memo,
}: {
  slug: string;
  initialStatus: string;
  paymentUri: string;
  address: string;
  memo: string;
}) {
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (status === "PAID" || status === "EXPIRED") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/pay/${slug}`, { cache: "no-store" });
        const body = await response.json();
        if (response.ok && body.payment?.status) setStatus(body.payment.status);
      } catch {
        // Keep the last known state; the next interval is a recoverable retry.
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [slug, status]);

  if (status === "PAID") return <div className="rupi-pay-confirmed"><CheckCircle2 size={38} aria-hidden="true" /><strong>Payment received</strong><p>Rupi found the Stellar USDC payment and matched its memo to this invoice.</p></div>;
  if (status === "EXPIRED") return <div className="rupi-pay-confirmed"><strong>This link has expired</strong><p>It cannot be reopened automatically. Ask the issuer to send a new payment link.</p></div>;
  return <>
    <div className="rupi-qr"><QRCodeSVG value={paymentUri} level="M" includeMargin title="Stellar payment QR code" /></div>
    <div className="rupi-pay-field"><span>Send USDC to</span><div><code className="rupi-address">{address}</code><CopyButton value={address} label="Copy" /></div></div>
    <div className="rupi-pay-field"><span>Required memo</span><div><code className="rupi-address">{memo}</code><CopyButton value={memo} label="Copy" /></div></div>
    <a href={paymentUri} className="rupi-button rupi-button-lime"><Wallet size={15} aria-hidden="true" />Open in Stellar wallet <ExternalLink size={14} aria-hidden="true" /></a>
  </>;
}
