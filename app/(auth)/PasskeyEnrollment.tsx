"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toCreationOptions(options: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const user = options.user as Record<string, unknown>;
  return {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromBase64Url(String(options.challenge)),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: fromBase64Url(String(user.id)) },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential) => ({ ...(credential as PublicKeyCredentialDescriptor), id: fromBase64Url(String((credential as Record<string, unknown>).id)) }))
      : undefined,
  };
}

function registrationResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export default function PasskeyEnrollment() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function enroll() {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setError("This browser does not support passkeys. Use a current browser on a supported device.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const optionsResponse = await fetch("/api/auth/passkeys/options", { method: "POST" });
      const optionsBody = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(optionsBody.error || "Could not start passkey enrollment.");
      const credential = await navigator.credentials.create({ publicKey: toCreationOptions(optionsBody.options as Record<string, unknown>) });
      if (!credential || !(credential instanceof PublicKeyCredential)) throw new Error("Passkey enrollment was cancelled.");
      const verify = await fetch("/api/auth/passkeys/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: registrationResponse(credential), name: "Primary passkey" }),
      });
      const verified = await verify.json().catch(() => ({}));
      if (!verify.ok) throw new Error(verified.error || "Could not verify this passkey.");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enroll a passkey.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="auth-card auth-card--passkey"><p className="app-eyebrow">Account security</p><h1>Add your passkey</h1><p className="muted">A passkey is required to protect your Rupi account and to authorize any movement of funds.</p>{error ? <p className="form-error" role="alert">{error}</p> : null}<button type="button" className="app-button primary" onClick={enroll} disabled={loading}>{loading ? "Setting up passkey…" : "Add passkey"}</button></section>;
}
