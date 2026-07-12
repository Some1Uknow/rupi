import { createHash, randomBytes, timingSafeEqual } from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getPool, withTransaction } from "./db";
import { getSiteUrl } from "./site";
import { recordAuditEvent } from "./audit";

const STEP_UP_ACTIONS = new Set([
  "LOGIN",
  "CASHOUT",
  "EXTERNAL_TRANSFER",
  "BENEFICIARY_CHANGE",
  "RECOVERY",
  "SECURITY_SETTINGS",
]);

type StoredPasskey = {
  id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
};

type Challenge = {
  id: string;
  challenge: string;
  purpose: "ENROLLMENT" | "STEP_UP";
  action: string | null;
  amount: string | null;
  idempotency_key: string | null;
  expires_at: string;
  used_at: string | null;
};

function config() {
  const origin = new URL(getSiteUrl()).origin;
  const rpId = process.env.WEBAUTHN_RP_ID?.trim() || new URL(origin).hostname;
  return { origin, rpId };
}

function validIdempotencyKey(value: string) {
  return /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

function normalizedAmount(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(raw)) throw new Error("Amount must be a positive USDC value with up to seven decimal places.");
  const [whole, fraction = ""] = raw.split(".");
  const canonical = `${whole.replace(/^0+(?=\d)/, "") || "0"}.${fraction.padEnd(7, "0")}`;
  if (BigInt(canonical.replace(".", "")) <= 0n) throw new Error("Amount must be greater than zero.");
  return canonical;
}

function asCredential(row: StoredPasskey) {
  return {
    id: row.credential_id,
    publicKey: new Uint8Array(row.public_key),
    counter: Number(row.counter),
    transports: row.transports as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">,
  };
}

async function getPasskeys(userId: string) {
  const result = await getPool().query<StoredPasskey>(
    `SELECT id, credential_id, public_key, counter::text, transports
     FROM passkeys WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows;
}

async function saveChallenge({
  userId,
  challenge,
  purpose,
  action = null,
  amount = null,
  idempotencyKey = null,
}: {
  userId: string;
  challenge: string;
  purpose: "ENROLLMENT" | "STEP_UP";
  action?: string | null;
  amount?: string | null;
  idempotencyKey?: string | null;
}) {
  await getPool().query(
    `INSERT INTO passkey_challenges (user_id, challenge, purpose, action, amount, idempotency_key, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '5 minutes')`,
    [userId, challenge, purpose, action, amount, idempotencyKey],
  );
}

function ensureUsableChallenge(challenge: Challenge, purpose: Challenge["purpose"]) {
  if (challenge.purpose !== purpose || challenge.used_at || Date.parse(challenge.expires_at) <= Date.now()) {
    throw new Error("This passkey request has expired. Start again.");
  }
}

export async function beginPasskeyEnrollment({ userId, email, displayName }: { userId: string; email: string; displayName?: string | null }) {
  const { rpId } = config();
  const existing = await getPasskeys(userId);
  const options = await generateRegistrationOptions({
    rpName: "Rupi",
    rpID: rpId,
    userID: new TextEncoder().encode(userId),
    userName: email,
    userDisplayName: displayName || email,
    timeout: 5 * 60_000,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.map((passkey) => ({ id: passkey.credential_id, transports: passkey.transports as never })),
  });
  await saveChallenge({ userId, challenge: options.challenge, purpose: "ENROLLMENT" });
  return options;
}

export async function finishPasskeyEnrollment({
  userId,
  response,
  name,
}: {
  userId: string;
  response: RegistrationResponseJSON;
  name?: string;
}) {
  const { origin, rpId } = config();
  const result = await withTransaction(async (client) => {
    const stored = await client.query<Challenge>(
      `SELECT id, challenge, purpose, action, amount::text, idempotency_key, expires_at, used_at
       FROM passkey_challenges
       WHERE user_id = $1 AND challenge = $2 FOR UPDATE`,
      [userId, response.response?.clientDataJSON ? await challengeFromClientData(response.response.clientDataJSON) : ""],
    );
    const challenge = stored.rows[0];
    if (!challenge) throw new Error("This passkey request was not found. Start again.");
    ensureUsableChallenge(challenge, "ENROLLMENT");
    const profile = await client.query<{ account_state: string }>(
      `SELECT account_state FROM account_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (profile.rows[0]?.account_state !== "PENDING_PASSKEY") {
      throw new Error("This account is not eligible for initial passkey enrollment.");
    }
    const existingPasskey = await client.query(
      `SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    if (existingPasskey.rowCount) {
      throw new Error("An existing account cannot add a passkey with email OTP alone.");
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Passkey registration could not be verified.");
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await client.query(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        userId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(response.response.transports || []),
        credentialDeviceType,
        credentialBackedUp,
        String(name || "Passkey").trim().slice(0, 80) || "Passkey",
      ],
    );
    await client.query("UPDATE passkey_challenges SET used_at = NOW() WHERE id = $1", [challenge.id]);
    await client.query(
      `INSERT INTO account_profiles (user_id, account_state)
       VALUES ($1, 'PENDING_KYC')
       ON CONFLICT (user_id) DO UPDATE SET account_state = CASE
         WHEN account_profiles.account_state = 'PENDING_PASSKEY' AND account_profiles.kyc_state = 'APPROVED' THEN 'ACTIVE'
         WHEN account_profiles.account_state = 'PENDING_PASSKEY' THEN 'PENDING_KYC'
         ELSE account_profiles.account_state END, updated_at = NOW()`,
      [userId],
    );
    return { credentialId: credential.id };
  });
  await recordAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    type: "PASSKEY_ENROLLED",
    message: "A passkey was enrolled.",
    metadata: { credentialId: result.credentialId.slice(0, 12) },
  });
  return result;
}

/**
 * Pulling the challenge out of clientData lets us select the exact one row
 * under a row lock before verifying. The signature still binds it below.
 */
async function challengeFromClientData(clientDataJSON: string) {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: string };
    return parsed.challenge || "";
  } catch {
    return "";
  }
}

export async function beginStepUp({
  userId,
  action,
  amount,
  idempotencyKey,
}: {
  userId: string;
  action: string;
  amount?: string;
  idempotencyKey: string;
}) {
  if (!STEP_UP_ACTIONS.has(action)) throw new Error("This action cannot be authorized with a passkey.");
  if (!validIdempotencyKey(idempotencyKey)) throw new Error("Use a valid idempotency key for passkey authorization.");
  const passkeys = await getPasskeys(userId);
  if (!passkeys.length) throw new Error("Enroll a passkey before authorizing this action.");
  const { rpId } = config();
  const normalized = normalizedAmount(amount);
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    timeout: 5 * 60_000,
    userVerification: "required",
    allowCredentials: passkeys.map((passkey) => ({ id: passkey.credential_id, transports: passkey.transports as never })),
  });
  await saveChallenge({
    userId,
    challenge: options.challenge,
    purpose: "STEP_UP",
    action,
    amount: normalized,
    idempotencyKey,
  });
  return options;
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export async function finishStepUp({ userId, response }: { userId: string; response: AuthenticationResponseJSON }) {
  const responseChallenge = await challengeFromClientData(response.response?.clientDataJSON || "");
  const { origin, rpId } = config();
  const outcome = await withTransaction(async (client) => {
    const challengeResult = await client.query<Challenge>(
      `SELECT id, challenge, purpose, action, amount::text, idempotency_key, expires_at, used_at
       FROM passkey_challenges WHERE user_id = $1 AND challenge = $2 FOR UPDATE`,
      [userId, responseChallenge],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge) throw new Error("This passkey authorization was not found. Start again.");
    ensureUsableChallenge(challenge, "STEP_UP");
    if (!challenge.action || !challenge.idempotency_key) throw new Error("This passkey authorization is invalid.");

    const passkeyResult = await client.query<StoredPasskey>(
      `SELECT id, credential_id, public_key, counter::text, transports
       FROM passkeys WHERE user_id = $1 AND credential_id = $2 FOR UPDATE`,
      [userId, response.id],
    );
    const passkey = passkeyResult.rows[0];
    if (!passkey) throw new Error("This passkey is not registered for your account.");
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: asCredential(passkey),
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Passkey authorization could not be verified.");

    const rawToken = challenge.action === "LOGIN" ? null : randomBytes(32).toString("base64url");
    await client.query(
      `UPDATE passkeys SET counter = $2, last_used_at = NOW() WHERE id = $1`,
      [passkey.id, verification.authenticationInfo.newCounter],
    );
    await client.query("UPDATE passkey_challenges SET used_at = NOW() WHERE id = $1", [challenge.id]);
    if (rawToken) {
      await client.query(
        `INSERT INTO step_up_tokens (token_hash, user_id, action, amount, idempotency_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '5 minutes')`,
        [tokenHash(rawToken), userId, challenge.action, challenge.amount, challenge.idempotency_key],
      );
    }
    return { token: rawToken, action: challenge.action, amount: challenge.amount, idempotencyKey: challenge.idempotency_key };
  });
  await recordAuditEvent({
    userId,
    actorType: "USER",
    actorId: userId,
    type: "PASSKEY_STEP_UP_SUCCEEDED",
    message: "A passkey step-up authorization succeeded.",
    metadata: { action: outcome.action },
  });
  return outcome;
}

export async function consumeStepUpToken({
  userId,
  action,
  amount,
  idempotencyKey,
  token,
}: {
  userId: string;
  action: string;
  amount?: string;
  idempotencyKey: string;
  token: string;
}) {
  const hash = tokenHash(token);
  const normalized = normalizedAmount(amount);
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string;
      token_hash: string;
      action: string;
      amount: string | null;
      idempotency_key: string | null;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, token_hash, action, amount::text, idempotency_key, expires_at, used_at
       FROM step_up_tokens WHERE user_id = $1 AND token_hash = $2 FOR UPDATE`,
      [userId, hash],
    );
    const stored = result.rows[0];
    const storedHash = stored ? Buffer.from(stored.token_hash) : Buffer.alloc(hash.length);
    const suppliedHash = Buffer.from(hash);
    if (!stored || storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) {
      throw new Error("Passkey authorization is invalid.");
    }
    if (
      stored.used_at || Date.parse(stored.expires_at) <= Date.now() || stored.action !== action ||
      stored.idempotency_key !== idempotencyKey || stored.amount !== normalized
    ) {
      throw new Error("Passkey authorization has expired or does not match this action.");
    }
    await client.query("UPDATE step_up_tokens SET used_at = NOW() WHERE id = $1", [stored.id]);
    return true;
  });
}
