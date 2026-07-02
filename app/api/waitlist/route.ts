import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";

let pool: Pool | null = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
  }

  return pool;
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(request: Request) {
  let body: { email?: unknown; name?: unknown; source?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim() || null;
  const source = String(body.source || "landing_page").trim() || "landing_page";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS waitlist_signups (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        source TEXT NOT NULL DEFAULT 'landing_page',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(
      `
        INSERT INTO waitlist_signups (email, name, source)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING
      `,
      [email, name, source],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "DATABASE_URL is not configured."
        ? error.message
        : "Could not save waitlist signup.";
    const status = message === "DATABASE_URL is not configured." ? 500 : 503;

    return NextResponse.json({ error: message }, { status });
  }
}
