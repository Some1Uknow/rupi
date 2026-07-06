import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://rupi.in";
const title = "Rupi — USDC invoices for Indian freelancers and remote workers";
const description =
  "Create USD invoices, get paid in Stellar USDC, track payments automatically, earn optional yield, and cash out to INR with Rupi.";
const ogImagePath = "/brand-kit/og.jpg";
const ogImageUrl = new URL(ogImagePath, siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/brand-kit/rupi-logo.png",
    shortcut: "/brand-kit/rupi-logo.png",
    apple: "/brand-kit/rupi-logo.png",
  },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "Rupi",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: ogImagePath,
        secureUrl: ogImageUrl,
        width: 1200,
        height: 630,
        alt: "Rupi preview showing Stellar invoicing and INR cash-out",
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [
      {
        url: ogImagePath,
        secureUrl: ogImageUrl,
        width: 1200,
        height: 630,
        alt: "Rupi preview showing Stellar invoicing and INR cash-out",
        type: "image/jpeg",
      },
    ],
  },
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
