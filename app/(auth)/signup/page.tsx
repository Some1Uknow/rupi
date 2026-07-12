import Link from "next/link";
import AuthForm from "../AuthForm";
import AuthShell from "../AuthShell";
import PasskeyEnrollment from "../PasskeyEnrollment";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  return (
    <AuthShell>
      {step === "passkey" ? <PasskeyEnrollment /> : (
        <section className="auth-card">
          <p className="app-eyebrow">Get started</p>
          <h1>Make money move clearly.</h1>
          <p className="muted">Verify your email first, then add a passkey to protect your account and future fund movement.</p>
          <AuthForm mode="signup" />
          <p className="auth-switch">
            Already have access? <Link href="/login">Sign in</Link>
          </p>
        </section>
      )}
    </AuthShell>
  );
}
