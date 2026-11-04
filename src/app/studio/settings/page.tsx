"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../../components/studio/studio-bar";

type Invite = { id: string; email: string; expiresAt: string; usedAt?: string; revokedAt?: string };
type Usage = { id: string; label: string; configured: boolean; used: number | null; limit: number | null };

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [resetEmail, setResetEmail] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [resetError, setResetError] = useState("");
  const [usage, setUsage] = useState<Usage[]>([]);
  const [connectNote, setConnectNote] = useState("");

  async function loadInvites() {
    const response = await fetch("/api/invites");
    if (response.ok) setInvites((await response.json()).items);
  }

  useEffect(() => {
    fetch("/api/auth/session").then(async (response) => {
      if (!response.ok) { router.replace("/sign-in"); return; }
      const body = await response.json();
      setName(body.user.name);
      setEmail(body.user.email);
      setIsOwner(body.user.isOwner);
      if (body.user.isOwner) void loadInvites();
    });
    fetch("/api/usage").then(async (response) => {
      if (response.ok) setUsage((await response.json()).providers || []);
    });
  }, [router]);

  function inviteState(invite: Invite) {
    if (invite.usedAt) return "Joined";
    if (invite.revokedAt) return "Revoked";
    return new Date(invite.expiresAt) <= new Date() ? "Expired" : "Pending";
  }

  return (
    <main className="app">
      <StudioBar name={name} />
      <div className="page-head">
        <div>
          <p className="kicker">Settings</p>
          <h1>{name || "Account"}</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>{email}</p>
        </div>
      </div>

      <div className="split">
        <section className="surface panel" aria-label="Usage">
          <div>
            <p className="kicker">This month</p>
            <h2>Provider usage</h2>
          </div>
          {usage.map((row) => (
            <div key={row.id} className="list-row">
              <span>{row.label}</span>
              <span className="mono muted">
                {!row.configured ? "not configured" : row.used === null ? "not metered" : `${row.used.toLocaleString()} / ${row.limit?.toLocaleString()} chars`}
              </span>
            </div>
          ))}
          <p className="fine">Narration characters are counted before each provider call. Cached lines are free. Work pauses when an allowance is used up.</p>
        </section>

        <section className="surface panel" aria-label="Publishing">
          <div>
            <p className="kicker">Publishing</p>
            <h2>YouTube and Instagram</h2>
          </div>
          <p className="fine">Direct posting is not switched on yet. Download the MP4 from a film and upload it yourself.</p>
          <button className="btn ghost" type="button" onClick={async () => {
            const response = await fetch("/api/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "youtube" }) });
            const body = await response.json();
            setConnectNote(body?.error?.message || "Connected.");
          }}>Connect YouTube</button>
          {connectNote ? <p className="fine" role="status">{connectNote}</p> : null}
        </section>
      </div>

      {isOwner ? (
        <div className="split">
          <section className="surface panel" aria-label="Invitations">
            <div>
              <p className="kicker">Owner</p>
              <h2>Invitations</h2>
            </div>
            <form className="share-box" onSubmit={async (event) => {
              event.preventDefault(); setInviteError(""); setInviteUrl(""); setInviteNote("");
              const response = await fetch("/api/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: inviteEmail }) });
              const body = await response.json();
              if (!response.ok) { setInviteError(body?.error?.message || "Could not create an invitation."); return; }
              setInviteUrl(body.url); setInviteEmail("");
              setInviteNote(body.delivery === "email" ? "Sent by email. The link is also below." : body.delivery === "email_failed" ? "The email did not send. Copy the link below instead." : "Copy and send this private link. It is shown once and expires in seven days.");
              await loadInvites();
            }}>
              <label htmlFor="invite-email" className="fine">Creator email</label>
              <div className="copy-row">
                <input id="invite-email" className="field" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                <button className="btn" type="submit">Create invitation</button>
              </div>
            </form>
            {inviteError ? <p className="error" role="alert">{inviteError}</p> : null}
            {inviteUrl ? <><p className="fine">{inviteNote}</p><input className="field mono" aria-label="Invitation link" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></> : null}
            <div>
              {invites.map((invite) => (
                <div className="list-row" key={invite.id}>
                  <span>{invite.email}</span>
                  <span className="row-actions">
                    <span className="badge" data-tone={inviteState(invite) === "Joined" ? "ready" : inviteState(invite) === "Pending" ? "review" : "draft"}>{inviteState(invite)}</span>
                    {inviteState(invite) === "Pending" ? <button className="btn quiet sm" type="button" onClick={async () => { await fetch(`/api/invites/${invite.id}/revoke`, { method: "POST" }); await loadInvites(); }}>Revoke</button> : null}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="surface panel" aria-label="Password resets">
            <div>
              <p className="kicker">Owner</p>
              <h2>Reset a creator password</h2>
            </div>
            <p className="fine">Makes a one-hour, single-use link. Use it when email is not set up.</p>
            <form className="copy-row" onSubmit={async (event) => {
              event.preventDefault(); setResetError(""); setResetUrl("");
              const response = await fetch("/api/resets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: resetEmail }) });
              const body = await response.json();
              if (!response.ok) { setResetError(body?.error?.message || "Could not make a reset link."); return; }
              setResetUrl(body.url); setResetEmail("");
            }}>
              <input className="field" type="email" aria-label="Creator email for reset" required value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
              <button className="btn ghost" type="submit">Make link</button>
            </form>
            {resetError ? <p className="error" role="alert">{resetError}</p> : null}
            {resetUrl ? <input className="field mono" aria-label="Reset link" readOnly value={resetUrl} onFocus={(event) => event.currentTarget.select()} /> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
