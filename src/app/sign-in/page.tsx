"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "../../components/brand";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message || "Could not sign in.");
        return;
      }
      router.push("/studio");
    } catch {
      setError("The studio did not answer. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit} className="surface">
        <Brand />
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>The studio is invite-only. Use the account from your invitation.</p>
        <input className="field" type="email" autoComplete="email" aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" required />
        <input className="field" type="password" autoComplete="current-password" aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="btn lg" type="submit" disabled={pending} style={{ width: "100%" }}>{pending ? "Checking" : "Enter the studio"}</button>
        <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <Link href="/reset" className="fine">Forgot your password?</Link>
          <Link href="/" className="fine">Back to the films</Link>
        </div>
      </form>
    </main>
  );
}
