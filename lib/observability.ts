import * as Sentry from "@sentry/nextjs";

type LogLevel = "info" | "warn" | "error";

function safeContext(context: Record<string, unknown> = {}) {
  // Only allow identifiers and finite numbers through this boundary. Raw
  // request bodies, emails, bank details, provider credentials, and tokens
  // must never be handed to a third-party error reporter.
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    ),
  );
}

export function logEvent(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "rupi",
    level,
    event,
    ...safeContext(context),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function captureException(error: unknown, event: string, context: Record<string, unknown> = {}) {
  logEvent("error", event, context);
  Sentry.withScope((scope) => {
    scope.setTag("event", event);
    scope.setContext("rupi", safeContext(context));
    Sentry.captureException(error);
  });
}
