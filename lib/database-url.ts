function isLocalHost(hostname: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.replace(/^\[|\]$/g, ""));
}

/**
 * PostgreSQL TLS is verified by default. The only non-TLS exception is an
 * explicitly local development database; production can never opt out with
 * sslmode=disable.
 */
export function databaseSslConfig(connectionString: string) {
  const url = new URL(connectionString);
  const local = isLocalHost(url.hostname);
  const disabled = url.searchParams.get("sslmode") === "disable";

  if (disabled && (!local || process.env.NODE_ENV === "production")) {
    throw new Error("sslmode=disable is allowed only for a local development database.");
  }
  if (local && process.env.NODE_ENV !== "production") return false;

  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  if (!ca) {
    throw new Error("DATABASE_CA_CERT is required to verify a non-local PostgreSQL certificate.");
  }
  return { rejectUnauthorized: true, ca };
}
