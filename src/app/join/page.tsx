"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "../../components/brand";

export default function JoinPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const token = window.location.hash.slice(1);
      const response = await fetch("/api/auth/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, password }) });
      const body = await response.json();
      if (!response.ok) { setError(body?.error?.message || "Could not use this invitation."); return; }
      window.history.replaceState(null, "", "/join");
      router.push("/studio");
    } catch { setError("The studio did not answer. Try again."); }
    finally { setPending(false); }
  }
  return <main className="auth"><form className="surface" onSubmit={submit}>
    <Brand /><h1>Join the studio</h1><p className="muted">Use the private invitation from the studio owner.</p>
    <label htmlFor="join-name" className="fine">Name</label><input id="join-name" className="field" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} required />
    <label htmlFor="join-password" className="fine">Password, at least 10 characters</label><input id="join-password" className="field" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="btn lg" disabled={pending} style={{ width: "100%" }}>{pending ? "Joining" : "Join the studio"}</button><Link href="/sign-in" className="fine">Already have an account? Sign in</Link>
  </form></main>;
}
