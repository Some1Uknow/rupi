"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function toBase64Url(value: ArrayBuffer | null) {
  if (!value) return undefined;
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toAuthenticationOptions(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64Url(String(options.challenge)),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map((credential) => ({
        ...(credential as PublicKeyCredentialDescriptor),
        id: fromBase64Url(String((credential as Record<string, unknown>).id)),
      }))
      : undefined,
  };
}

function assertionResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: toBase64Url(response.userHandle),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export default function PasskeyLogin() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function continueWithPasskey() {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setError("This browser does not support the passkey required to continue.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const optionsResponse = await fetch("/api/auth/step-up/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LOGIN", idempotencyKey }),
      });
      const optionsBody = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(optionsBody.error || "Could not start passkey verification.");
      const credential = await navigator.credentials.get({ publicKey: toAuthenticationOptions(optionsBody.options as Record<string, unknown>) });
      if (!credential || !(credential instanceof PublicKeyCredential)) throw new Error("Passkey verification was cancelled.");
      const verification = await fetch("/api/auth/step-up/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertionResponse(credential) }),
      });
      const body = await verification.json().catch(() => ({}));
      if (!verification.ok) throw new Error(body.error || "Could not verify your passkey.");
      router.replace("/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify your passkey.");
    } finally {
      setLoading(false);
    }
  }

  async function startRecovery() {
    if (!window.confirm("Start account recovery? This immediately revokes all sessions and locks the account for manual review.")) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/recovery", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not start account recovery.");
      setError(body.message || "Recovery is under review.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start account recovery.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="auth-card auth-card--passkey">
    <p className="app-eyebrow">Passkey required</p>
    <h1>Confirm it’s you</h1>
    <p className="muted">Your email code started this session. Use your enrolled passkey before accessing Rupi.</p>
    {error ? <p className="form-error">{error}</p> : null}
    <button type="button" className="app-button primary" onClick={continueWithPasskey} disabled={loading}>
      {loading ? "Verifying passkey…" : "Continue with passkey"}
    </button>
    <button type="button" className="auth-text-button" onClick={startRecovery} disabled={loading}>Lost every passkey? Start recovery</button>
    <p className="auth-switch">Recovery revokes all sessions and requires manual review, including for accounts holding funds.</p>
    <p className="auth-switch">If support has approved a passkey reset, <Link href="/signup?step=passkey">enroll a new passkey</Link>.</p>
  </section>;
}
