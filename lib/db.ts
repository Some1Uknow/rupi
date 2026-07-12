import { Pool } from "pg";
import { databaseSslConfig } from "./database-url";
import { assertProductionEnvironment } from "./env";

let pool: Pool | null = null;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    assertProductionEnvironment();
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: databaseSslConfig(process.env.DATABASE_URL),
      max: Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return pool;
}

export async function withTransaction<T>(work: (client: import("pg").PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
