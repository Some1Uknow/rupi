"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, LoaderCircle, Mail } from "lucide-react";

type AuthMode = "login" | "signup";

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestCode() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "sign-in" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not send a verification code.");
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a verification code.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, ...(mode === "signup" && name.trim() ? { name: name.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "The verification code is invalid or expired.");
      router.push(mode === "signup" ? "/signup?step=passkey" : "/login?step=passkey");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the code.");
    } finally {
      setLoading(false);
    }
  }

  const actionLabel = requested ? "Verify and continue" : "Send verification code";

  return (
    <form action={requested ? verifyCode : requestCode} className="auth-form" aria-busy={loading}>
      {mode === "signup" ? (
        <label>
          <span>Name <em>optional</em></span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} placeholder="Your name" />
        </label>
      ) : null}
      <label>
        <span>Email <b aria-hidden="true">*</b></span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@example.com" spellCheck={false} required disabled={requested} />
      </label>
      {requested ? (
        <label>
          <span>Verification code <b aria-hidden="true">*</b></span>
          <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" placeholder="000000" spellCheck={false} required />
          <small>We sent a six-digit code to your verified email. It expires in 10 minutes.</small>
        </label>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="app-button primary" disabled={loading || (requested && otp.length !== 6)}>
        {loading ? <><LoaderCircle className="auth-spinner" size={17} aria-hidden="true" /> Working…</> : <>{requested ? <KeyRound size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}{actionLabel}<ArrowRight size={16} aria-hidden="true" /></>}
      </button>
      {requested ? <button type="button" className="auth-text-button" onClick={() => { setRequested(false); setOtp(""); setError(""); }} disabled={loading}>Use a different email</button> : null}
    </form>
  );
}
