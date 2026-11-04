"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "../../components/brand";

export default function ResetPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // The token lives in the URL fragment, which only the browser can read.
    const frame = requestAnimationFrame(() => setToken(window.location.hash.slice(1)));
    return () => cancelAnimationFrame(frame);
  }, []);

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError(""); setNote("");
    try {
      const response = await fetch("/api/auth/reset-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) setError(body?.error?.message || "Could not ask for a reset.");
      else setNote(body.message);
    } catch { setError("The studio did not answer. Try again."); }
    finally { setPending(false); }
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = await response.json();
      if (!response.ok) { setError(body?.error?.message || "Could not reset the password."); return; }
      window.history.replaceState(null, "", "/reset");
      router.push("/studio");
    } catch { setError("The studio did not answer. Try again."); }
    finally { setPending(false); }
  }

  return (
    <main className="auth">
      {token ? (
        <form className="surface" onSubmit={reset}>
          <Brand />
          <h1>Choose a new password</h1>
          <p className="muted" style={{ margin: 0 }}>This signs you out everywhere else.</p>
          <label htmlFor="reset-password" className="fine">New password, at least 10 characters</label>
          <input id="reset-password" className="field" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="btn lg" style={{ width: "100%" }} disabled={pending}>{pending ? "Saving" : "Save password"}</button>
        </form>
      ) : (
        <form className="surface" onSubmit={request}>
          <Brand />
          <h1>Reset your password</h1>
          <label htmlFor="reset-email" className="fine">Email</label>
          <input id="reset-email" className="field" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          {note ? <p className="notice" role="status">{note}</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="btn lg" style={{ width: "100%" }} disabled={pending}>{pending ? "Sending" : "Send reset link"}</button>
          <Link href="/sign-in" className="fine">Back to sign in</Link>
        </form>
      )}
    </main>
  );
}
