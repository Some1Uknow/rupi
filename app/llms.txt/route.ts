import { getSiteUrl } from "@/lib/site";

export const revalidate = false;

export function GET() {
  const base = getSiteUrl();
  return new Response(`# Rupi\n\nStellar Testnet documentation for invoices, Testnet USDC, Blend Yield, and simulated INR cash-out.\n\n- Docs: ${base}/docs\n- Full LLM documentation: ${base}/llms-full.txt\n- Testnet contract addresses in Markdown: ${base}/docs/addresses.md\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
