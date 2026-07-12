export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ assertProductionEnvironment }, Sentry] = await Promise.all([
      import("./lib/env"),
      import("@sentry/nextjs"),
    ]);
    const runtimeProduction = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
    if (runtimeProduction) {
      assertProductionEnvironment();
      const { getPool } = await import("./lib/db");
      const migration = await getPool().query<{ name: string }>(
        "SELECT name FROM rupi_schema_migrations WHERE name = ANY($1::text[])",
        [["001_mainnet_core.sql", "002_provider_event_claim.sql", "003_session_passkey_assurance.sql"]],
      );
      if (migration.rowCount !== 3) throw new Error("Required Mainnet database migrations have not been applied.");
    }
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.RUPI_ENVIRONMENT || process.env.NODE_ENV,
        sendDefaultPii: false,
        tracesSampleRate: 0.05,
      });
    }
  }
}
