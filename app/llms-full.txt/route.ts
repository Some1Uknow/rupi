import { docsMarkdown } from "@/lib/docs";

export const revalidate = false;

export function GET() {
  return new Response(docsMarkdown, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
