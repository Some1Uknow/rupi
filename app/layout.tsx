import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://rupi.in";
const title = "Rupi — USDC invoices for Indian freelancers and remote workers";
const description =
  "Create USD invoices, get paid in Stellar USDC, track payments automatically, earn optional yield, and cash out to INR with Rupi.";

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
        url: "/brand-kit/og.png",
        width: 1731,
        height: 909,
        alt: "Rupi social preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/brand-kit/og.png"],
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
