import { NextResponse, type NextRequest } from "next/server";
import { isProductAppEnabled } from "./lib/flags";

const gatedPrefixes = [
  "/dashboard",
  "/transactions",
  "/invoices",
  "/balance",
  "/yield",
  "/pay",
  "/cashout",
  "/reports",
  "/settings",
  "/api/invoices",
  "/api/pay",
  "/api/dev",
  "/api/wallet",
  "/api/yield",
  "/api/cashout",
  "/api/cron",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const isGated = gatedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isGated && !isProductAppEnabled()) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(NextResponse.json({ error: "Product app is not enabled." }, { status: 404 }), nonce);
    }
    return withSecurityHeaders(NextResponse.redirect(new URL("/", request.url)), nonce);
  }

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), nonce);
}

function withSecurityHeaders(response: NextResponse, nonce: string) {
  const production = process.env.NODE_ENV === "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("X-Nonce", nonce);
  if (production) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
