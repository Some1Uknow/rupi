import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pay/"],
      disallow: ["/dashboard", "/transactions", "/invoices", "/balance", "/yield", "/cashout", "/reports", "/settings", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
