import { getSiteUrl } from "@/lib/site";

export const revalidate = false;

export function GET() {
  const base = getSiteUrl();
  return new Response(`# Rupi\n\nMainnet documentation for Stellar USDC invoices, Fireblocks-managed custody, and staged Onramp INR settlement. Yield is unavailable in this release.\n\n- Docs: ${base}/docs\n- Full LLM documentation: ${base}/llms-full.txt\n- Legal disclosures: ${base}/legal/custody-risk\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
