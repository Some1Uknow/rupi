import Link from "next/link";
import AuthForm from "../AuthForm";
import AuthShell from "../AuthShell";
import PasskeyLogin from "../PasskeyLogin";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ step?: string; recovery?: string }> }) {
  const { step, recovery } = await searchParams;
  return (
    <AuthShell>
      {step === "passkey" ? <PasskeyLogin /> : (
        <section className="auth-card">
          <p className="app-eyebrow">Secure sign in</p>
          <h1>Welcome back.</h1>
          <p className="muted">Enter your email and we&apos;ll send a six-digit verification code. Rupi never asks you to create a password.</p>
          {recovery === "review" ? <p className="form-error">Your account is locked for recovery review. Check your verified email or contact the grievance team.</p> : null}
          <AuthForm mode="login" />
          <p className="auth-switch">
            New to Rupi? <Link href="/signup">Create an account</Link>
          </p>
        </section>
      )}
    </AuthShell>
  );
}
