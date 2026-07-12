import type { Metadata } from "next";
import { headers } from "next/headers";
import { createMetadata } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = createMetadata();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="en">
      <body nonce={nonce}>{children}</body>
    </html>
  );
}
