import { getSiteUrl } from "./site";

/** Require browser-initiated state changes to originate from this deployment. */
export function assertSameOrigin(request: Request) {
  const expected = new URL(getSiteUrl()).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const actual = origin || (referer ? new URL(referer).origin : "");
  if (!actual || actual !== expected) throw new Error("Cross-site request blocked.");
}
