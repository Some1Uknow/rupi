import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rupi — USDC invoices for Indian freelancers and remote workers",
  description:
    "Create USD invoices, get paid in Stellar USDC, track payments automatically, earn optional yield, and cash out to INR with Rupi.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
