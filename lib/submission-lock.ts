import { getPool } from "./db";

/** Serialize sequence-number-consuming transactions per Stellar source account. */
export async function withStellarSubmissionLock<T>(publicKey: string, work: () => Promise<T>) {
  const client = await getPool().connect();
  const key = `rupi:stellar-submit:${publicKey}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => null);
    client.release();
  }
}
