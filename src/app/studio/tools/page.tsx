"use client";

import { useState } from "react";
import { StudioBar } from "../../../components/studio/studio-bar";
import { api, usePending, waitForJob } from "../../../components/ui/client";
import { Button, CopyRow, Notice, Panel } from "../../../components/ui/kit";

type CopyField = { text: string; length: number; limit: number; ok: boolean; flags: string[] };
const FONTS = [["playfair", "Playfair Display"], ["instrument-serif", "Instrument Serif"], ["inter-black", "Inter Black"], ["bricolage", "Bricolage"], ["pinyon", "Pinyon Script"]] as const;

/** Static creator tools: profile banners and profile copy. */
export default function ToolsPage() {
  return (
    <main className="app">
      <StudioBar />
      <div className="page-head"><div><p className="kicker">Creator tools</p><h1>Banners and bios</h1></div></div>
      <div className="split align-start">
        <BannerTool />
        <CopyTool />
      </div>
    </main>
  );
}

function BannerTool() {
  const { run, busy } = usePending();
  const [b, setB] = useState({ platform: "linkedin", headline: "", subline: "", note: "", background: "#14121c", accent: "#ff8a3d", text: "#fff8ee", headlineFont: "playfair", noteFont: "caveat", pattern: "glow" });
  const [out, setOut] = useState<{ banner: string; guides: string; size: string } | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  const set = (patch: Partial<typeof b>) => setB({ ...b, ...patch });

  const make = () => run("make", async () => {
    setError(""); setOut(null);
    const res = await api<{ jobId: string }>("/api/tools", { body: { tool: "banner", input: b } });
    if (!res.ok) { setError(res.error); return; }
    setState("Drawing the banner...");
    const job = await waitForJob(res.data.jobId);
    setState("");
    if (job?.state !== "succeeded") { setError(job?.error?.message ?? "The banner was not drawn."); return; }
    setOut({ banner: String(job.result?.bannerAssetId), guides: String(job.result?.guidesAssetId), size: String(job.result?.size) });
  });

  return (
    <Panel kicker="Banner" title="Profile banner">
      <div className="chips" role="radiogroup" aria-label="Platform">
        {[["linkedin", "LinkedIn 1584×396"], ["x", "X 1500×500"]].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={b.platform === id} className={b.platform === id ? "chip is-on" : "chip"} onClick={() => set({ platform: id })}>{label}</button>)}
      </div>
      <label className="stack-label">Headline<input className="field" value={b.headline} maxLength={60} onChange={(e) => set({ headline: e.target.value })} placeholder="I make films that teach" /></label>
      <label className="stack-label">Second line<input className="field" value={b.subline} maxLength={90} onChange={(e) => set({ subline: e.target.value })} placeholder="Explainers, code walkthroughs and stories" /></label>
      <label className="stack-label">Handwritten note<input className="field" value={b.note} maxLength={40} onChange={(e) => set({ note: e.target.value })} placeholder="hi, I'm Riya" /></label>
      <div className="grid-3">
        <label className="stack-label">Background<input type="color" value={b.background} onChange={(e) => set({ background: e.target.value })} /></label>
        <label className="stack-label">Accent<input type="color" value={b.accent} onChange={(e) => set({ accent: e.target.value })} /></label>
        <label className="stack-label">Text<input type="color" value={b.text} onChange={(e) => set({ text: e.target.value })} /></label>
      </div>
      <div className="split">
        <label className="stack-label">Headline font<select className="field" value={b.headlineFont} onChange={(e) => set({ headlineFont: e.target.value })}>{FONTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="stack-label">Pattern<select className="field" value={b.pattern} onChange={(e) => set({ pattern: e.target.value })}><option value="glow">Glow</option><option value="grid">Grid</option><option value="dots">Dots</option><option value="none">Plain</option></select></label>
      </div>
      <Button tone="accent" pending={busy("make")} disabled={b.headline.trim().length < 2} onClick={() => void make()}>Draw banner</Button>
      {state ? <p className="fine" role="status">{state}</p> : null}
      {out ? (
        <div className="stack-label">
          <img className="banner-preview" src={`/api/assets/${out.banner}/file`} alt="Your banner" />
          <div className="row-actions"><a className="btn sm" href={`/api/assets/${out.banner}/file?download=1`}>Download PNG ({out.size})</a></div>
          <p className="fine">Safe areas: green is where words stay readable; red is covered by the profile photo or cropped on phones.</p>
          <img className="banner-preview" src={`/api/assets/${out.guides}/file`} alt="Your banner with safe areas marked" />
        </div>
      ) : null}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

function CopyTool() {
  const { run, busy } = usePending();
  const [c, setC] = useState({ name: "", role: "", facts: "", audience: "", tone: "warm" });
  const [out, setOut] = useState<Record<string, CopyField> | null>(null);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof c>) => setC({ ...c, ...patch });

  const draft = () => run("draft", async () => {
    setError(""); setOut(null);
    const res = await api<{ jobId: string }>("/api/tools", { body: { tool: "profile-copy", input: c } });
    if (!res.ok) { setError(res.error); return; }
    const job = await waitForJob(res.data.jobId);
    if (job?.state !== "succeeded") { setError(job?.error?.message ?? "The copy was not drafted."); return; }
    setOut((job.result?.copy as Record<string, CopyField>) ?? null);
  });

  const LABEL: Record<string, string> = { headline: "LinkedIn headline", about: "LinkedIn About", xBio: "X bio", instagramBio: "Instagram bio" };
  return (
    <Panel kicker="Profile copy" title="Headline, About and bios">
      <p className="fine">Drafted only from the facts you give. Any number that is not in your facts is flagged for you to check.</p>
      <div className="split">
        <label className="stack-label">Name<input className="field" value={c.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="stack-label">Role<input className="field" value={c.role} maxLength={160} onChange={(e) => set({ role: e.target.value })} placeholder="Student and video creator" /></label>
      </div>
      <label className="stack-label">Facts about you (what you do, have done, care about)
        <textarea className="field" value={c.facts} maxLength={3000} onChange={(e) => set({ facts: e.target.value })} placeholder="Final-year CS student. Built SceneSpindle. Teaches DSA with short films." />
      </label>
      <div className="split">
        <label className="stack-label">Audience<input className="field" value={c.audience} maxLength={200} onChange={(e) => set({ audience: e.target.value })} placeholder="Recruiters and students" /></label>
        <label className="stack-label">Tone<select className="field" value={c.tone} onChange={(e) => set({ tone: e.target.value })}><option value="warm">Warm</option><option value="crisp">Crisp</option><option value="playful">Playful</option><option value="formal">Formal</option></select></label>
      </div>
      <Button tone="accent" pending={busy("draft")} disabled={!c.name.trim() || c.role.trim().length < 2 || c.facts.trim().length < 10} onClick={() => void draft()}>Draft my copy</Button>
      {out ? Object.entries(out).map(([key, field]) => (
        <div key={key} className="stack-label">
          <span className="stack-label-text">{LABEL[key] ?? key} · {field.length} of {field.limit} characters {field.ok ? "✓" : "· check"}</span>
          {key === "about" ? <p className="copy-out">{field.text}</p> : <CopyRow value={field.text} />}
          {field.flags.map((flag) => <p key={flag} className="fine error">{flag}</p>)}
        </div>
      )) : null}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}
