import type { Metadata } from "next";

export const siteConfig = {
  name: "Rupi",
  title: "Rupi — USDC invoices for Indian freelancers and remote workers",
  description:
    "Create USD invoices, receive Stellar Mainnet USDC, track confirmed payments, and cash out to INR through Onramp with Rupi.",
  locale: "en_US",
} as const;

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  // Static route analysis runs before a deployment's runtime secret set is
  // injected. This value is never accepted at runtime: instrumentation and
  // production startup validation still require NEXT_PUBLIC_APP_URL.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "https://build.rupi.invalid";
  }

  throw new Error("NEXT_PUBLIC_APP_URL must be configured outside local development.");
}

type CreateMetadataOptions = {
  title?: string;
  description?: string;
  path?: string;
};

export function createMetadata({
  title = siteConfig.title,
  description = siteConfig.description,
  path = "/",
}: CreateMetadataOptions = {}): Metadata {
  const siteUrl = getSiteUrl();

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: {
      canonical: path,
    },
    icons: {
      icon: "/brand-kit/rupi-logo.png",
      shortcut: "/brand-kit/rupi-logo.png",
      apple: "/brand-kit/rupi-logo.png",
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: siteConfig.name,
      type: "website",
      locale: siteConfig.locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
