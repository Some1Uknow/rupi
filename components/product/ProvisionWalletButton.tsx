"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WalletCards } from "lucide-react";

export function ProvisionWalletButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function provision() {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/wallet/provision", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not set up your Stellar wallet.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up your Stellar wallet.");
      setState("error");
    }
  }

  return <div className="rupi-provision"><button className="rupi-button rupi-button-lime" type="button" onClick={provision} disabled={state === "loading"}><WalletCards size={16} aria-hidden="true" />{state === "loading" ? "Setting up wallet…" : "Set up Stellar wallet"}</button>{error ? <p className="rupi-form-error">{error}</p> : null}</div>;
}
