import { docsMarkdown } from "@/lib/docs";

export const revalidate = false;

export function GET() {
  return new Response(docsMarkdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
