"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../../components/studio/studio-bar";
import { api, useLoad, usePending } from "../../../components/ui/client";
import { Button, CopyRow, MODE_LABEL, Notice, Panel, timeAgo } from "../../../components/ui/kit";

type Account = { id: string; email: string; name: string; owner: boolean; prefs: { defaultMode?: string; defaultFormat?: string; defaultLanguage?: string; defaultTargetMs?: number; defaultVoiceId?: string } };
type Voice = { id: string; label: string; available: boolean; reason?: string; note: string; languages?: string[] };

export default function SettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  useLoad(async () => {
    const res = await api<{ account: Account }>("/api/account");
    if (!res.ok) { router.replace("/sign-in"); return; }
    setAccount(res.data.account);
    const cat = await api<{ voices: Voice[] }>("/api/catalog");
    if (cat.ok) setVoices(cat.data.voices);
  }, []);
  return (
    <main className="app">
      <StudioBar />
      <div className="page-head"><div><p className="kicker">{account?.email ?? "Settings"}</p><h1>Settings</h1></div></div>
      {!account ? <div className="surface panel skeleton tall" /> : (
        <div className="split align-start">
          <div className="ws-main">
            <AccountPanel account={account} voices={voices} onSaved={setAccount} />
            <PasswordPanel />
            <SessionsPanel />
            <UsagePanel />
          </div>
          <div className="ws-main">
            <AgentsPanel />
            <TokensPanel />
            {account.owner ? <InvitesPanel /> : null}
            {account.owner ? <ResetsPanel /> : null}
            {account.owner ? <AllowancesPanel /> : null}
          </div>
        </div>
      )}
    </main>
  );
}

function AccountPanel({ account, voices, onSaved }: { account: Account; voices: Voice[]; onSaved: (a: Account) => void }) {
  const { run, busy } = usePending();
  const [name, setName] = useState(account.name);
  const [prefs, setPrefs] = useState({ defaultMode: account.prefs.defaultMode ?? "explainer", defaultFormat: account.prefs.defaultFormat ?? "9x16", defaultLanguage: account.prefs.defaultLanguage ?? "en", defaultTargetMs: account.prefs.defaultTargetMs ?? 45000, defaultVoiceId: account.prefs.defaultVoiceId ?? "elevenlabs:alice" });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = () => run("save", async () => {
    setError("");
    const res = await api<{ account: Account }>("/api/account", { method: "PATCH", body: { name, prefs } });
    if (!res.ok) { setError(res.error); return; }
    onSaved(res.data.account);
    setNote("Saved. New projects start with these settings.");
  });
  return (
    <Panel kicker="You" title="Account and defaults">
      <label className="stack-label">Name<input aria-label="Name" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <div className="split">
        <label className="stack-label">New projects are<select aria-label="New projects are" className="field" value={prefs.defaultMode} onChange={(e) => setPrefs({ ...prefs, defaultMode: e.target.value })}>{Object.entries(MODE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label className="stack-label">Format<select aria-label="Format" className="field" value={prefs.defaultFormat} onChange={(e) => setPrefs({ ...prefs, defaultFormat: e.target.value })}><option value="9x16">Vertical 9:16</option><option value="16x9">Landscape 16:9</option><option value="1x1">Square 1:1</option></select>
        </label>
      </div>
      <div className="split">
        <label className="stack-label">Language<select aria-label="Language" className="field" value={prefs.defaultLanguage} onChange={(e) => setPrefs({ ...prefs, defaultLanguage: e.target.value })}><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option></select>
        </label>
        <label className="stack-label">Length<select aria-label="Length" className="field" value={prefs.defaultTargetMs} onChange={(e) => setPrefs({ ...prefs, defaultTargetMs: Number(e.target.value) })}>{[15000, 30000, 45000, 60000, 90000, 120000, 180000].map((ms) => <option key={ms} value={ms}>{ms < 60000 ? `${ms / 1000} seconds` : `${ms / 60000} min`}</option>)}</select>
        </label>
      </div>
      <label className="stack-label">Narrator<select aria-label="Narrator" className="field" value={prefs.defaultVoiceId} onChange={(e) => setPrefs({ ...prefs, defaultVoiceId: e.target.value })}>{voices.map((v) => <option key={v.id} value={v.id} disabled={!v.available}>{v.label}{v.available ? "" : " (not set up)"}</option>)}</select>
      </label>
      <Button pending={busy("save")} disabled={!name.trim()} onClick={() => void save()}>Save</Button>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

function PasswordPanel() {
  const { run, busy } = usePending();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const change = (event: React.FormEvent) => {
    event.preventDefault();
    void run("pw", async () => {
      setError("");
      const res = await api("/api/account/password", { body: { current, next } });
      if (!res.ok) { setError(res.error); return; }
      setCurrent(""); setNext("");
      setNote("Password changed. Other browsers were signed out.");
    });
  };
  return (
    <Panel kicker="Security" title="Change password">
      <form className="stack-label" onSubmit={change}>
        <label className="stack-label">Current password<input aria-label="Current password" className="field" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="stack-label">New password (12 or more characters)<input aria-label="New password (12 or more characters)" className="field" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <Button type="submit" pending={busy("pw")} disabled={!current || next.length < 12}>Change password</Button>
      </form>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

function SessionsPanel() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<{ id: string; lastSeenAt: string; userAgent: string; current: boolean }[]>([]);
  const [note, setNote] = useState("");
  const load = useCallback(async () => { const res = await api<{ items: typeof items }>("/api/auth/sessions"); if (res.ok) setItems(res.data.items); }, []);
  useLoad(load, [load]);
  const out = () => run("out", async () => {
    const res = await api<{ signedOut: number }>("/api/auth/sessions", { method: "DELETE" });
    if (res.ok) setNote(`Signed out of ${res.data.signedOut} other ${res.data.signedOut === 1 ? "browser" : "browsers"}.`);
    await load();
  });
  return (
    <Panel kicker="Security" title="Where you are signed in">
      {items.map((s) => <div key={s.id} className="list-row"><span>{s.userAgent.split(")")[0].replace("(", "· ") || "Browser"}{s.current ? " (this one)" : ""}</span><span className="fine">{timeAgo(s.lastSeenAt)}</span></div>)}
      <Button tone="ghost" pending={busy("out")} disabled={items.length <= 1} onClick={() => void out()}>Sign out everywhere else</Button>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
    </Panel>
  );
}

type UsageRow = { id: string; label: string; unit: string; configured: boolean; mine: number; myLimit: number | null; studio?: number; studioLimit?: number };
function UsagePanel() {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [period, setPeriod] = useState("");
  useLoad(async () => { const res = await api<{ providers: UsageRow[]; period: string }>("/api/usage"); if (res.ok) { setRows(res.data.providers); setPeriod(res.data.period); } }, []);
  return (
    <Panel kicker={`Usage · ${period}`} title="This month">
      {!rows ? <p className="fine">Loading</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Service</th><th>You</th>{rows.some((r) => r.studio !== undefined) ? <th>Studio</th> : null}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.label}{r.configured ? "" : <span className="fine"> · not set up</span>}</td><td className="mono">{r.mine.toLocaleString()} {r.unit}{r.myLimit !== null ? ` of ${r.myLimit.toLocaleString()}` : ""}</td>{r.studio !== undefined ? <td className="mono">{r.studio.toLocaleString()} of {(r.studioLimit ?? 0) > 1e12 ? "∞" : (r.studioLimit ?? 0).toLocaleString()}</td> : null}</tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="fine">Studio-side count. Work pauses when an allowance is used up. The provider dashboard is the billing source of truth.</p>
    </Panel>
  );
}

type Agent = { id: string; name: string; paired: boolean; online: boolean; lastSeenAt: string | null; pairingExpiresAt: string | null; capabilities: { blender?: boolean; os?: string } };
function AgentsPanel() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => { const res = await api<{ items: Agent[] }>("/api/agents"); if (res.ok) setItems(res.data.items); }, []);
  useLoad(load, [load]);
  const pair = () => run("pair", async () => {
    setError("");
    const res = await api<{ code: string }>("/api/agents", { body: { name } });
    if (!res.ok) { setError(res.error); return; }
    setCode(res.data.code); setName("");
    await load();
  });
  const unpair = (a: Agent) => run(`un-${a.id}`, async () => {
    if (!confirm(`Unpair ${a.name}? Its token stops working now.`)) return;
    const res = await api(`/api/agents/${a.id}`, { method: "DELETE" });
    if (!res.ok) setError(res.error);
    await load();
  });
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Panel kicker="Your PC" title="Render on your own computer">
      <p className="fine">A paired PC renders projects set to “My paired PC” with its own tools and keys (and Blender for cinematic 3D). It never gets the studio’s database or provider keys, and can only take your jobs.</p>
      <div className="composer-row">
        <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Studio laptop" aria-label="PC name" />
        <Button pending={busy("pair")} disabled={!name.trim()} onClick={() => void pair()}>Pair a PC</Button>
      </div>
      {code ? (
        <div className="stack-label">
          <span className="stack-label-text">On that PC, in a SceneSpindle checkout, run (code works for 15 minutes, once):</span>
          <CopyRow value={`npm run agent -- pair ${code} --url ${origin}`} />
          <CopyRow value="npm run agent" />
        </div>
      ) : null}
      {items.map((a) => (
        <div key={a.id} className="list-row">
          <span><strong>{a.name}</strong> <span className="fine">{a.paired ? (a.online ? "online" : `last seen ${timeAgo(a.lastSeenAt)}`) : "waiting for pairing"}{a.capabilities?.blender ? " · Blender" : ""}{a.capabilities?.os ? ` · ${a.capabilities.os}` : ""}</span></span>
          <Button tone="quiet" size="sm" pending={busy(`un-${a.id}`)} onClick={() => void unpair(a)}>Unpair</Button>
        </div>
      ))}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

type Token = { id: string; name: string; prefix: string; lastUsedAt?: string; expiresAt: string; revokedAt?: string };
function TokensPanel() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [fresh, setFresh] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => { const res = await api<{ items: Token[] }>("/api/tokens"); if (res.ok) setItems(res.data.items.filter((t) => !t.revokedAt)); }, []);
  useLoad(load, [load]);
  const create = () => run("create", async () => {
    setError("");
    const res = await api<{ token: string }>("/api/tokens", { body: { name, days } });
    if (!res.ok) { setError(res.error); return; }
    setFresh(res.data.token); setName("");
    await load();
  });
  const revoke = (t: Token) => run(`rev-${t.id}`, async () => {
    const res = await api(`/api/tokens/${t.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });
  return (
    <Panel kicker="Developers" title="API tokens">
      <p className="fine">For the CLI (<span className="mono">studio remote</span>) and AI editors (<span className="mono">npm run mcp</span>). A token acts as you.</p>
      <div className="composer-row">
        <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Laptop CLI" aria-label="Token name" />
        <select className="field field-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Lifetime"><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select>
        <Button pending={busy("create")} disabled={!name.trim()} onClick={() => void create()}>Create token</Button>
      </div>
      {fresh ? <><p className="fine">Copy it now. It is not shown again.</p><CopyRow value={fresh} name="New token" /></> : null}
      {items.map((t) => <div key={t.id} className="list-row"><span><strong>{t.name}</strong> <span className="fine mono">{t.prefix}… · expires {new Date(t.expiresAt).toLocaleDateString()}{t.lastUsedAt ? ` · used ${timeAgo(t.lastUsedAt)}` : ""}</span></span><Button tone="quiet" size="sm" pending={busy(`rev-${t.id}`)} onClick={() => void revoke(t)}>Revoke</Button></div>)}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

type Invite = { id: string; email: string; expiresAt: string; usedAt?: string; revokedAt?: string };
function InvitesPanel() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => { const res = await api<{ items: Invite[] }>("/api/invites"); if (res.ok) setItems(res.data.items); }, []);
  useLoad(load, [load]);
  const state = (i: Invite) => (i.usedAt ? "joined" : i.revokedAt ? "revoked" : new Date(i.expiresAt) <= new Date() ? "expired" : "pending");
  const invite = () => run("invite", async () => {
    setError("");
    const res = await api<{ url: string; delivery: string }>("/api/invites", { body: { email } });
    if (!res.ok) { setError(res.error); return; }
    setLink(res.data.url); setEmail("");
    await load();
  });
  const resend = (i: Invite) => run(`resend-${i.id}`, async () => {
    const res = await api<{ url: string }>(`/api/invites/${i.id}/resend`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setLink(res.data.url);
    await load();
  });
  const revoke = (i: Invite) => run(`rev-${i.id}`, async () => {
    const res = await api(`/api/invites/${i.id}/revoke`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });
  return (
    <Panel kicker="Owner" title="Invite a creator">
      <div className="composer-row">
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" aria-label="Email to invite" />
        <Button pending={busy("invite")} disabled={!email.includes("@")} onClick={() => void invite()}>Create invitation</Button>
      </div>
      {link ? <><p className="fine">Send this link. It works once, for seven days.</p><CopyRow value={link} /></> : null}
      {items.map((i) => (
        <div key={i.id} className="list-row">
          <span>{i.email} <span className="badge" data-tone={state(i) === "joined" ? "ready" : state(i) === "pending" ? "review" : "failed"}>{state(i)}</span></span>
          {state(i) === "pending" || state(i) === "expired" ? <span className="row-actions"><Button tone="ghost" size="sm" pending={busy(`resend-${i.id}`)} onClick={() => void resend(i)}>New link</Button><Button tone="quiet" size="sm" pending={busy(`rev-${i.id}`)} onClick={() => void revoke(i)}>Revoke</Button></span> : null}
        </div>
      ))}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

function ResetsPanel() {
  const { run, busy } = usePending();
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const make = () => run("reset", async () => {
    setError("");
    const res = await api<{ url: string }>("/api/resets", { body: { email } });
    if (!res.ok) { setError(res.error); return; }
    setLink(res.data.url);
  });
  return (
    <Panel kicker="Owner" title="Password reset link">
      <div className="composer-row">
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="creator@example.com" aria-label="Email to reset" />
        <Button tone="ghost" pending={busy("reset")} disabled={!email.includes("@")} onClick={() => void make()}>Make reset link</Button>
      </div>
      {link ? <CopyRow value={link} /> : null}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

type Creator = { id: string; email: string; name: string; allowances: Record<string, number>; used: Record<string, number> };
function AllowancesPanel() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Creator[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const res = await api<{ items: Creator[]; providers: string[] }>("/api/usage/allowances"); if (res.ok) { setItems(res.data.items); setProviders(res.data.providers); } }, []);
  useLoad(load, [load]);
  const set = (userId: string, provider: string, value: string) => run(`${userId}-${provider}`, async () => {
    const limit = value.trim() === "" ? null : Number(value);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0)) { setError("Use a whole number, or leave empty for no cap."); return; }
    const res = await api("/api/usage/allowances", { method: "PATCH", body: { userId, provider, limit } });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });
  return (
    <Panel kicker="Owner" title="Creator allowances">
      <p className="fine">Monthly caps per creator. Empty means only the studio cap applies.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Creator</th>{providers.map((p) => <th key={p}>{p}</th>)}</tr></thead>
        <tbody>{items.map((c) => (
          <tr key={c.id}><td>{c.name}<div className="fine">{c.email}</div></td>{providers.map((p) => (
            <td key={p}><input className="field field-sm mono" style={{ width: 96 }} defaultValue={c.allowances[p] ?? ""} placeholder="no cap" aria-label={`${p} cap for ${c.email}`} disabled={busy(`${c.id}-${p}`)} onBlur={(e) => { if (e.target.value !== String(c.allowances[p] ?? "")) void set(c.id, p, e.target.value); }} /><div className="fine mono">{(c.used[p] ?? 0).toLocaleString()} used</div></td>
          ))}</tr>
        ))}</tbody>
      </table></div>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}
