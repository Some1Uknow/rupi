import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSiteUrl } from "./site";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { databaseSslConfig } from "./database-url";
import { getPool } from "./db";
import { isLocalDevelopment } from "./env";

let authDb: Kysely<unknown> | null = null;
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

function getAuthDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && !isBuild) {
    throw new Error("DATABASE_URL is required for authentication.");
  }

  if (!authDb) {
    const pool = new Pool({
      // Next evaluates route modules while compiling. This never services a
      // request and never connects; runtime still rejects an absent database.
      connectionString: databaseUrl || "postgresql://build:build@localhost/rupi_build",
      ssl: isBuild ? false : databaseUrl ? databaseSslConfig(databaseUrl) : false,
    });
    authDb = new Kysely({ dialect: new PostgresDialect({ pool }) });
  }

  return {
    db: authDb,
    type: "postgres" as const,
  };
}

function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    if (isBuild) return "build-only-auth-secret-not-valid-at-runtime-0123456789";
    throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

async function sendOtpEmail({ email, otp }: { email: string; otp: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    throw new Error("Resend email OTP delivery is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Rupi verification code",
      text: `Your Rupi verification code is ${otp}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(7_500),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Rupi could not send the verification code.");
}

export const auth = betterAuth({
  appName: "Rupi",
  baseURL: getSiteUrl(),
  secret: authSecret(),
  database: getAuthDatabase(),
  emailAndPassword: {
    enabled: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 6,
    freshAge: 60 * 5,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "rupi",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: "hashed",
      rateLimit: { window: 60, max: 3 },
      sendVerificationOTP: ({ email, otp }) => sendOtpEmail({ email, otp }),
    }),
    nextCookies(),
  ],
});

export async function getCurrentAuthSession() {
  return auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
}

export async function getCurrentUser() {
  const session = await getCurrentAuthSession();
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export type AccountProfile = {
  account_state: "PENDING_PASSKEY" | "PENDING_KYC" | "ACTIVE" | "RECOVERY_REVIEW" | "SUSPENDED";
  kyc_state: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVIEW";
  onramp_customer_id: string | null;
  cashout_rollout_eligible: boolean;
};

export async function ensureAccountProfile(userId: string) {
  await getPool().query(
    `INSERT INTO account_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function getAccountProfile(userId: string): Promise<AccountProfile | null> {
  const result = await getPool().query<AccountProfile>(
    `SELECT account_state, kyc_state, onramp_customer_id, cashout_rollout_eligible FROM account_profiles WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function markSessionPasskeyAssured({ sessionId, userId }: { sessionId: string; userId: string }) {
  await getPool().query(
    `INSERT INTO session_passkey_assurances (session_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE SET user_id = EXCLUDED.user_id, asserted_at = NOW()`,
    [sessionId, userId],
  );
}

async function hasSessionPasskeyAssurance({ sessionId, userId }: { sessionId: string; userId: string }) {
  const result = await getPool().query(
    `SELECT 1
     FROM session_passkey_assurances assurance
     JOIN "session" session_record ON session_record."id" = assurance.session_id
     WHERE assurance.session_id = $1
       AND assurance.user_id = $2
       AND session_record."userId" = $2
       AND session_record."expiresAt" > NOW()`,
    [sessionId, userId],
  );
  return Boolean(result.rowCount);
}

/** Use for product APIs so an email OTP session alone cannot read account data. */
export async function getPasskeyAssuredUser() {
  const current = await getCurrentAuthSession();
  if (!current) return null;
  const profile = await getAccountProfile(current.user.id);
  if (!profile || ["PENDING_PASSKEY", "SUSPENDED", "RECOVERY_REVIEW"].includes(profile.account_state)) return null;
  const assured = await hasSessionPasskeyAssurance({ sessionId: current.session.id, userId: current.user.id });
  return assured ? current.user : null;
}

/** Dashboard access is withheld until the required passkey is enrolled. */
export async function requireEnrolledUser() {
  const current = await getCurrentAuthSession();
  if (!current) redirect("/login");
  const user = current.user;
  const profile = await getAccountProfile(user.id);
  if (!profile || profile.account_state === "PENDING_PASSKEY") {
    redirect("/signup?step=passkey");
  }
  if (profile.account_state === "SUSPENDED" || profile.account_state === "RECOVERY_REVIEW") {
    redirect("/login?recovery=review");
  }
  if (!await hasSessionPasskeyAssurance({ sessionId: current.session.id, userId: user.id })) {
    redirect("/login?step=passkey");
  }
  return { user, profile };
}

export function canUseLocalAuthDevelopment() {
  return isLocalDevelopment();
}
