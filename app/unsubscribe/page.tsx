"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function UnsubscribePage() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "error">("working");

  useEffect(() => {
    const email = searchParams.get("email") || "";
    const token = searchParams.get("token") || "";
    void fetch("/api/account/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token }),
    }).then((response) => setState(response.ok ? "done" : "error")).catch(() => setState("error"));
  }, [searchParams]);

  return <main className="auth-page"><section className="auth-card"><h1>{state === "working" ? "Updating preferences…" : state === "done" ? "You’re unsubscribed" : "We could not update your preferences"}</h1><p className="muted">{state === "done" ? "You will no longer receive launch-list emails from Rupi." : "If this link has expired, contact Rupi support from the address you used to sign up."}</p></section></main>;
}
