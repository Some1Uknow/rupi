"use client";

import { useState } from "react";

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

function requestOptions(options: Record<string, unknown>): PublicKeyCredentialRequestOptions {
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

export function DeleteAccountRequest() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function requestDeletion() {
    if (!window.confirm("Request deletion of your Rupi account data? Financial records may still be retained where required by law.")) return;
    if (!window.PublicKeyCredential || !navigator.credentials) {
      setMessage("This browser does not support the required passkey authorization.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const idempotencyKey = crypto.randomUUID();
      const optionsResponse = await fetch("/api/auth/step-up/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SECURITY_SETTINGS", idempotencyKey }),
      });
      const optionsBody = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(optionsBody.error || "Could not start passkey authorization.");
      const credential = await navigator.credentials.get({ publicKey: requestOptions(optionsBody.options as Record<string, unknown>) });
      if (!credential || !(credential instanceof PublicKeyCredential)) throw new Error("Passkey authorization was cancelled.");
      const verification = await fetch("/api/auth/step-up/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertionResponse(credential) }),
      });
      const verified = await verification.json().catch(() => ({}));
      if (!verification.ok || !verified.authorization?.token) throw new Error(verified.error || "Could not verify passkey authorization.");
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, stepUpToken: verified.authorization.token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not submit the deletion request.");
      setMessage(body.message || "Your deletion request was recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the deletion request.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="rupi-surface">
    <div className="rupi-surface-header"><div><h2>Data deletion</h2><p>Submit a privacy request for review. A fresh passkey assertion is required.</p></div></div>
    <button className="rupi-button rupi-button-light" type="button" onClick={requestDeletion} disabled={loading}>
      {loading ? "Authorizing request…" : "Request data deletion"}
    </button>
    {message ? <p className="rupi-form-error">{message}</p> : null}
  </section>;
}
