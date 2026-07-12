"use client";

import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { ShortAddress } from "./Primitives";

export function WalletCard({ address, issuer }: { address: string; issuer: string }) {
  const [open, setOpen] = useState(false);
  return <section className="rupi-surface rupi-wallet-card">
    <div className="rupi-surface-header"><div><h2>Receive USDC</h2></div><button className="rupi-icon-button" type="button" onClick={() => setOpen(!open)}><QrCode size={15} aria-hidden="true" /><span>{open ? "Hide QR" : "Show QR"}</span></button></div>
    <div className="rupi-wallet-address-block"><span>Your wallet</span><div><code>{open ? address : <ShortAddress address={address} />}</code><CopyButton value={address} label="Copy" /></div></div>
    {open ? <div className="rupi-wallet-qr"><QRCodeSVG value={`web+stellar:pay?destination=${encodeURIComponent(address)}&asset_code=USDC&asset_issuer=${encodeURIComponent(issuer)}`} level="M" includeMargin /></div> : null}
  </section>;
}
