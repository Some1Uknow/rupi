const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function required(name: string, errors: string[]) {
  const value = process.env[name]?.trim();
  if (!value) errors.push(`${name} is required.`);
  return value || "";
}

function requireMinimumLength(name: string, minimum: number, errors: string[]) {
  const value = required(name, errors);
  if (value && value.length < minimum) errors.push(`${name} must be at least ${minimum} characters.`);
  return value;
}

function requireHttpsUrl(name: string, errors: string[]) {
  const value = required(name, errors);
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname)) {
      errors.push(`${name} must be a non-local HTTPS URL.`);
    }
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
  return value;
}

/**
 * Checks only configuration that is necessary to safely start a Mainnet
 * process. It deliberately does not make provider calls at startup; the
 * deployment health check performs those with bounded timeouts.
 */
export function assertProductionEnvironment() {
  if (!isProduction()) return;

  const errors: string[] = [];
  const databaseUrl = required("DATABASE_URL", errors);
  requireMinimumLength("BETTER_AUTH_SECRET", 32, errors);
  requireHttpsUrl("NEXT_PUBLIC_APP_URL", errors);
  required("WEBAUTHN_RP_ID", errors);
  requireHttpsUrl("FIREBLOCKS_API_BASE_URL", errors);
  required("FIREBLOCKS_API_KEY", errors);
  required("FIREBLOCKS_PRIVATE_KEY", errors);
  required("FIREBLOCKS_WEBHOOK_SECRET", errors);
  required("FIREBLOCKS_STELLAR_XLM_ASSET_ID", errors);
  required("FIREBLOCKS_STELLAR_USDC_ASSET_ID", errors);
  required("FIREBLOCKS_TREASURY_VAULT_ID", errors);
  required("FIREBLOCKS_USER_XLM_RESERVE", errors);
  required("FIREBLOCKS_POLICY_ID", errors);
  requireHttpsUrl("ONRAMP_API_BASE_URL", errors);
  required("ONRAMP_APP_ID", errors);
  required("ONRAMP_API_KEY", errors);
  required("ONRAMP_API_SECRET", errors);
  required("ONRAMP_QUOTE_SIGNING_SECRET", errors);
  required("ONRAMP_WEBHOOK_SECRET", errors);
  requireMinimumLength("RESEND_API_KEY", 12, errors);
  required("RESEND_FROM_EMAIL", errors);
  requireHttpsUrl("UPSTASH_REDIS_REST_URL", errors);
  required("UPSTASH_REDIS_REST_TOKEN", errors);
  required("CRON_SECRET", errors);
  required("SENTRY_DSN", errors);
  required("NEXT_PUBLIC_GRIEVANCE_EMAIL", errors);
  requireMinimumLength("WAITLIST_UNSUBSCRIBE_SECRET", 32, errors);
  required("OPERATOR_API_TOKEN", errors);
  required("RUPI_EXPECTED_RELEASE_SHA", errors);
  required("DATABASE_CA_CERT", errors);
  required("STELLAR_USDC_ISSUER", errors);

  if (process.env.RUPI_ENVIRONMENT !== "mainnet") {
    errors.push("RUPI_ENVIRONMENT must be exactly 'mainnet' in production.");
  }
  if (process.env.STELLAR_NETWORK !== "mainnet") {
    errors.push("STELLAR_NETWORK must be exactly 'mainnet' in production.");
  }
  if (process.env.FIREBLOCKS_POLICY_STATE !== "enforced") {
    errors.push("FIREBLOCKS_POLICY_STATE must be exactly 'enforced' after Fireblocks policy review.");
  }
  if (!process.env.VERCEL_GIT_COMMIT_SHA && !process.env.RUPI_RELEASE_SHA) {
    errors.push("Set RUPI_RELEASE_SHA when the host does not expose VERCEL_GIT_COMMIT_SHA.");
  }
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (url.searchParams.get("sslmode") === "disable") {
        errors.push("DATABASE_URL must not use sslmode=disable in production.");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL URL.");
    }
  }

  if (errors.length) {
    throw new Error(`Unsafe production configuration:\n- ${errors.join("\n- ")}`);
  }
}

export function isLocalDevelopment() {
  return process.env.NODE_ENV !== "production" && process.env.RUPI_ENVIRONMENT !== "mainnet";
}

export function getRequiredServerUrl(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return new URL(value);
}
