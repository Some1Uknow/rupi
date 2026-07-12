import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;

function sslConfig(databaseUrl) {
  const url = new URL(databaseUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, ""));
  if (local && process.env.NODE_ENV !== "production") return false;
  if (url.searchParams.get("sslmode") === "disable") {
    throw new Error("sslmode=disable is permitted only for a local development database.");
  }
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  if (!ca) throw new Error("DATABASE_CA_CERT is required to verify a non-local PostgreSQL certificate.");
  return {
    rejectUnauthorized: true,
    ca,
  };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");

const client = new Client({ connectionString: databaseUrl, ssl: sslConfig(databaseUrl) });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS rupi_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("SELECT pg_advisory_lock(hashtext('rupi:mainnet:migrations'))");
  const directory = join(process.cwd(), "db", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const applied = await client.query("SELECT 1 FROM rupi_schema_migrations WHERE name = $1", [file]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(directory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO rupi_schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('rupi:mainnet:migrations'))").catch(() => undefined);
  await client.end();
}
