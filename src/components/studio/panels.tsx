"use client";

import { useEffect, useRef, useState } from "react";
import { runBrowserTrace } from "../../trace/browser-client";
import { api, usePending, waitForJob } from "../ui/client";
import { Button, Notice, Panel } from "../ui/kit";
import { AssetPicker } from "./asset-picker";

export type ProjectView = {
  id: string; title: string; mode: string; format: string; targetMs: number; language: string; voiceId: string; badge: string;
  castIds: string[]; seriesId: string | null; seriesVersion: number | null; episodeNumber: number | null;
  lyrics: { songAssetId: string; lrc: string } | null; look: "stage" | "illustrated"; executionTarget: "hosted" | "paired-agent";
  renderProfile: "realtime-3d" | "cinematic-3d"; recap: string; montage: Record<string, unknown> | null;
};
export type Voice = { id: string; label: string; available: boolean; reason?: string; timing: string; commercial: boolean; note: string; languages?: string[] };
export type Catalog = { voices: Voice[]; story: { looks: { id: string; label: string; available: boolean; reason?: string }[] }; captions: { transcription: boolean; reason?: string; autoPlacement: boolean }; research: { available: boolean; note: string }; montageStyles: { id: string; label: string; note: string }[] };

const LENGTHS = [15000, 30000, 45000, 60000, 90000, 120000, 180000];

/* ------------------------------------------------------------------ settings */

export function SettingsPanel({ project, catalog, onSaved, onError, planLanguage }: { project: ProjectView; catalog: Catalog | null; onSaved: (p: ProjectView, draftRevision?: number) => void; onError: (m: string) => void; planLanguage?: string }) {
  const { run, busy } = usePending();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; online: boolean; paired: boolean; capabilities: { blender?: boolean } }[]>([]);
  const film = !["montage", "reel"].includes(project.mode);
  const narrated = film && project.mode !== "lyrics";
  const illustrated = project.mode === "story" || project.mode === "cartoon";

  useEffect(() => { void api<{ items: typeof agents }>("/api/agents").then((res) => { if (res.ok) setAgents(res.data.items.filter((a) => a.paired)); }); }, []);

  const save = (patch: Partial<ProjectView>) => run(`save-${Object.keys(patch)[0]}`, async () => {
    const res = await api<{ project: ProjectView; draftRevision?: number }>(`/api/projects/${project.id}`, { method: "PATCH", body: patch });
    if (!res.ok) { onError(res.error); return; }
    onSaved(res.data.project, res.data.draftRevision);
  });

  const sample = (id: string) => run("sample", async () => {
    const url = `/api/catalog/voices/${encodeURIComponent(id)}/sample?language=${project.language}`;
    const head = await fetch(url);
    if (!head.ok) { const body = await head.json().catch(() => null); onError(body?.error?.message ?? "No sample right now."); return; }
    const blob = URL.createObjectURL(await head.blob());
    if (audio.current) { audio.current.pause(); }
    audio.current = new Audio(blob);
    await audio.current.play().catch(() => {});
  });

  const voices = catalog?.voices ?? [];
  const voice = voices.find((v) => v.id === project.voiceId);
  const paired = agents.length > 0;
  const blender = agents.some((a) => a.capabilities?.blender);

  return (
    <Panel kicker="Settings" title="How it is made">
      <div className="grid-3">
        <label className="stack-label">Format<select className="field" aria-label="Format" value={project.format} disabled={busy("save-format")} onChange={(e) => void save({ format: e.target.value })}>
            <option value="9x16">Vertical 9:16</option><option value="16x9">Landscape 16:9</option><option value="1x1">Square 1:1</option>
          </select>
        </label>
        {film ? (
          <label className="stack-label">Language<select className="field" aria-label="Language" value={project.language} disabled={busy("save-language")} onChange={(e) => void save({ language: e.target.value })}>
              <option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option>
            </select>
          </label>
        ) : null}
        {film && project.mode !== "lyrics" ? (
          <label className="stack-label">Length<select className="field" aria-label="Length" value={project.targetMs} disabled={busy("save-targetMs")} onChange={(e) => void save({ targetMs: Number(e.target.value) })}>
              {LENGTHS.map((ms) => <option key={ms} value={ms}>{ms < 60000 ? `${ms / 1000} seconds` : `${ms / 60000} min`}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {planLanguage && planLanguage !== project.language ? <Notice tone="warn">The storyboard is in {planLanguage === "hi" ? "Hindi" : planLanguage === "hinglish" ? "Hinglish" : "English"}. Plan it again to switch language.</Notice> : null}
      {narrated ? (
        <div className="stack-label">
          <span className="stack-label-text">Narrator</span>
          <div className="row-actions">
            <select className="field grow" aria-label="Narrator" value={project.voiceId} disabled={busy("save-voiceId")} onChange={(e) => void save({ voiceId: e.target.value })}>
              {voices.map((item) => {
                const speaks = !item.languages || item.languages.includes(planLanguage ?? project.language);
                return <option key={item.id} value={item.id} disabled={!item.available || !speaks}>{item.label}{!item.available ? " (not set up)" : !speaks ? " (other language)" : ""}</option>;
              })}
            </select>
            <Button tone="ghost" size="sm" pending={busy("sample")} disabled={!voice?.available} onClick={() => void sample(project.voiceId)}>▶ Hear it</Button>
          </div>
          {voice ? <p className="fine">{voice.note}</p> : null}
        </div>
      ) : null}
      {illustrated ? (
        <div className="stack-label">
          <span className="stack-label-text">Look</span>
          <div className="chips" role="radiogroup" aria-label="Look">
            {(catalog?.story.looks ?? [{ id: "stage", label: "3D stage", available: true }]).map((look) => (
              <button key={look.id} type="button" role="radio" aria-checked={project.look === look.id} className={project.look === look.id ? "chip is-on" : "chip"} disabled={!look.available || busy("save-look")} title={look.reason} onClick={() => void save({ look: look.id as ProjectView["look"] })}>{look.label}</button>
            ))}
          </div>
          <p className="fine">{project.look === "illustrated" ? "Each beat becomes a painted still with your cast as reference, with a slow camera move. Draw the stills before approving." : "Your cast performs each beat on a 3D set, lips moving with the narration."} Changing the look applies the next time you plan.</p>
        </div>
      ) : null}
      {film || project.mode === "montage" ? (
        <div className="stack-label">
          <span className="stack-label-text">Render on</span>
          <div className="chips" role="radiogroup" aria-label="Render on">
            <button type="button" role="radio" aria-checked={project.executionTarget === "hosted"} className={project.executionTarget === "hosted" ? "chip is-on" : "chip"} disabled={busy("save-executionTarget")} onClick={() => void save({ executionTarget: "hosted" })}>Studio worker</button>
            <button type="button" role="radio" aria-checked={project.executionTarget === "paired-agent"} className={project.executionTarget === "paired-agent" ? "chip is-on" : "chip"} disabled={!paired || busy("save-executionTarget")} title={paired ? undefined : "Pair a PC in Settings first"} onClick={() => void save({ executionTarget: "paired-agent" })}>My paired PC</button>
          </div>
          {!paired ? <p className="fine">Pair your own PC in Settings to render there with its own keys and tools.</p> : null}
          {illustrated && project.look === "stage" && project.executionTarget === "paired-agent" ? (
            <label className="row-actions fine">
              <input type="checkbox" checked={project.renderProfile === "cinematic-3d"} disabled={!blender || busy("save-renderProfile")} onChange={(e) => void save({ renderProfile: e.target.checked ? "cinematic-3d" : "realtime-3d" })} />
              Cinematic 3D with Blender {blender ? "" : "(your paired PC needs Blender installed)"}
            </label>
          ) : null}
        </div>
      ) : null}
      {project.seriesId ? (
        <label className="stack-label">Episode recap (later episodes build on it)<textarea aria-label="Episode recap (later episodes build on it)" className="field" defaultValue={project.recap} maxLength={600} onBlur={(e) => { if (e.target.value !== project.recap) void save({ recap: e.target.value }); }} placeholder="What happened in this episode, in two sentences" />
        </label>
      ) : null}
    </Panel>
  );
}

/* --------------------------------------------------------------------- brief */

type Direction = { id: "clear" | "story" | "visual"; title: string; approach: string; tradeoff: string };
type BriefResult = { objective: string; audience: string | null; selectedDirectionId: Direction["id"] | null; directions: Direction[]; questions: { id: string; prompt: string }[]; assumptions: string[]; mustInclude: string[]; mustAvoid: string[]; contentHash: string; state: string };
type Research = { status: string; summary?: string; sources?: { url: string; title: string; retrievedAt?: string }[]; at?: string } | null;
type StoredBrief = { revision: number; version: number; input: { rawRequest: string; objective?: string; audience?: string; exactScript?: string; mustInclude?: string[]; mustAvoid?: string[]; directionId?: Direction["id"]; researchMode?: string }; result: BriefResult; state: string; research: Research };

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => l.slice(0, 160));

export function BriefPanel({ scope, id, suggested, audience, researchAvailable, onApproved }: { scope: "projects" | "series"; id: string; suggested: string; audience?: string; researchAvailable: boolean; onApproved?: () => void }) {
  const { run, busy } = usePending();
  const [brief, setBrief] = useState<StoredBrief | null>(null);
  const [form, setForm] = useState({ rawRequest: "", objective: "", audience: "", exactScript: "", mustInclude: "", mustAvoid: "", researchMode: "auto" });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [researching, setResearching] = useState(false);
  const base = `/api/${scope}/${id}/brief`;

  const adopt = (b: StoredBrief) => {
    setBrief(b);
    setForm({ rawRequest: b.input.rawRequest ?? "", objective: b.input.objective ?? "", audience: b.input.audience ?? "", exactScript: b.input.exactScript ?? "", mustInclude: (b.input.mustInclude ?? []).join("\n"), mustAvoid: (b.input.mustAvoid ?? []).join("\n"), researchMode: b.input.researchMode ?? "auto" });
  };

  useEffect(() => { void api<{ brief: StoredBrief | null }>(base).then((res) => { if (res.ok && res.data.brief) adopt(res.data.brief); }); }, [base]);

  const input = () => ({
    rawRequest: (form.rawRequest.trim() || suggested.trim()).slice(0, 20000), objective: form.objective.trim() || undefined, audience: form.audience.trim() || audience?.trim() || undefined,
    exactScript: form.exactScript.trim() || undefined, mustInclude: lines(form.mustInclude), mustAvoid: lines(form.mustAvoid), directionId: brief?.input.directionId, researchMode: form.researchMode,
  });

  const refine = () => run("refine", async () => {
    setError(""); setNote("");
    if ((form.rawRequest.trim() || suggested.trim()).length < 8) { setError("Describe the video in at least a few words."); return; }
    const res = await api<StoredBrief>(`${base}/refine`, { body: { expectedRevision: brief?.revision ?? 0, input: input() } });
    if (!res.ok) { setError(res.reason === "REVISION_CONFLICT" ? "This brief changed in another tab. Reload the page." : res.error); return; }
    adopt(res.data);
    setNote(res.data.result.state === "needs_input" ? "Pick a direction below." : "Brief ready to review.");
  });

  const answer = (choice: Direction["id"]) => run("answer", async () => {
    if (!brief) return;
    const res = await api<StoredBrief>(`${base}/answers`, { body: { expectedRevision: brief.revision, decisionId: "direction", choice } });
    if (!res.ok) { setError(res.error); return; }
    adopt(res.data);
    setNote("Direction saved.");
  });

  const approve = () => run("approve", async () => {
    if (!brief) return;
    const res = await api<{ version: number }>(`${base}/approve`, { body: { expectedRevision: brief.revision, contentHash: brief.result.contentHash } });
    if (!res.ok) { setError(res.error); return; }
    setBrief({ ...brief, version: res.data.version, state: "approved" });
    setNote(`Brief approved and saved as version ${res.data.version}.`);
    onApproved?.();
  });

  const research = () => run("research", async () => {
    setError("");
    const res = await api<{ jobId: string }>(`${base}/research`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setResearching(true);
    const job = await waitForJob(res.data.jobId);
    setResearching(false);
    if (job?.state !== "succeeded") { setError(job?.error?.message ?? "Research did not finish."); return; }
    const fresh = await api<{ brief: StoredBrief | null }>(base);
    if (fresh.ok && fresh.data.brief) setBrief(fresh.data.brief);
    setNote("Research added. Check the sources before you approve.");
  });

  const r = brief?.result;
  return (
    <Panel kicker={scope === "series" ? "Series brief" : "Creative brief"} title="What we will make" actions={brief ? <span className="badge" data-tone={brief.state === "approved" ? "ready" : "review"}>{brief.state === "approved" ? `approved v${brief.version}` : brief.state.replaceAll("_", " ")}</span> : null}>
      <p className="fine">Shape the idea before planning. Your exact words and must-haves are kept as you wrote them.</p>
      <label className="stack-label">What should this video do?<textarea className="field" aria-label="What should this video do?" value={form.rawRequest} onChange={(e) => setForm({ ...form, rawRequest: e.target.value })} placeholder={suggested || "Describe the video in your own words"} maxLength={20000} />
      </label>
      <div className="split">
        <label className="stack-label">Goal, in one line (optional)<input className="field" aria-label="Goal, in one line" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} maxLength={2000} placeholder="Viewers understand why ice floats" />
        </label>
        <label className="stack-label">Audience<input className="field" aria-label="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} maxLength={200} placeholder={audience || "Curious teens"} />
        </label>
      </div>
      <div className="split">
        <label className="stack-label">Must include (one per line)<textarea className="field small" aria-label="Must include" value={form.mustInclude} onChange={(e) => setForm({ ...form, mustInclude: e.target.value })} placeholder={"Hydrogen bonds\nA glass of water"} />
        </label>
        <label className="stack-label">Must avoid (one per line)<textarea className="field small" aria-label="Must avoid" value={form.mustAvoid} onChange={(e) => setForm({ ...form, mustAvoid: e.target.value })} placeholder="Jargon" />
        </label>
      </div>
      <label className="stack-label">Exact script, if you have one<textarea className="field" aria-label="Exact script, if you have one" value={form.exactScript} onChange={(e) => setForm({ ...form, exactScript: e.target.value })} placeholder="Leave blank to let the planner write it. A script here is kept word for word." maxLength={30000} />
      </label>
      <div className="row-actions">
        <label className="stack-label inline">Research
          <select className="field field-sm" value={form.researchMode} onChange={(e) => setForm({ ...form, researchMode: e.target.value })} aria-label="Research">
            <option value="auto">When useful</option><option value="requested">Always</option><option value="off">Off</option>
          </select>
        </label>
        <Button tone="ghost" pending={busy("refine")} onClick={() => void refine()}>{brief ? "Update brief" : "Refine brief"}</Button>
        {brief && form.researchMode !== "off" ? <Button tone="ghost" pending={busy("research") || researching} disabled={!researchAvailable} title={researchAvailable ? undefined : "Needs the planner key"} onClick={() => void research()}>Research the facts</Button> : null}
      </div>
      {r ? (
        <div className="brief-result">
          <p><strong>{r.objective}</strong></p>
          <p className="fine">Audience: {r.audience || "to be confirmed"}{r.mustInclude.length ? ` · Must include: ${r.mustInclude.join(", ")}` : ""}{r.mustAvoid.length ? ` · Avoid: ${r.mustAvoid.join(", ")}` : ""}</p>
          <div className="cards directions" role="radiogroup" aria-label="Direction">
            {r.directions.map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={r.selectedDirectionId === d.id} className={`surface card direction ${r.selectedDirectionId === d.id ? "is-on" : ""}`} disabled={busy("answer")} onClick={() => void answer(d.id)}>
                <strong>{d.title}</strong><span>{d.approach}</span><span className="fine">{d.tradeoff}</span>
              </button>
            ))}
          </div>
          {r.assumptions.map((item) => <p className="fine" key={item}>{item}</p>)}
          {brief?.research ? (
            <div className="research">
              <p className="kicker">Research · {brief.research.status === "done" ? "with sources" : brief.research.status === "running" ? "running" : "unverified"}</p>
              {brief.research.summary ? <p className="research-text">{brief.research.summary}</p> : null}
              {brief.research.sources?.length ? <ul className="sources">{brief.research.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>{s.retrievedAt ? <span className="fine"> · {new Date(s.retrievedAt).toLocaleDateString()}</span> : null}</li>)}</ul> : null}
            </div>
          ) : null}
          {r.state === "ready_for_review" && brief?.state !== "approved" ? <Button pending={busy("approve")} onClick={() => void approve()}>Approve brief</Button> : null}
        </div>
      ) : null}
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

/* ------------------------------------------------------------------ code lab */

const SAMPLES = {
  python: [
    { id: "binary_search", label: "Binary search", entry: "binary_search", input: "[[4, 9, 15, 21, 28, 33], 21]", code: `def binary_search(arr, target):\n    lo = 0\n    hi = len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n` },
    { id: "fib", label: "fib(4)", entry: "fib", input: "[4]", code: `def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)\n` },
    { id: "sum", label: "Sum a list", entry: "total", input: "[[3, 1, 4, 1, 5]]", code: `def total(arr):\n    s = 0\n    for i in range(len(arr)):\n        s += arr[i]\n    return s\n` },
  ],
  javascript: [
    { id: "binarySearch", label: "Binary search", entry: "binarySearch", input: "[[4, 9, 15, 21, 28, 33], 21]", code: `function binarySearch(arr, target) {\n  let lo = 0;\n  let hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = Math.floor((lo + hi) / 2);\n    if (arr[mid] === target) {\n      return mid;\n    } else if (arr[mid] < target) {\n      lo = mid + 1;\n    } else {\n      hi = mid - 1;\n    }\n  }\n  return -1;\n}\n` },
    { id: "factorial", label: "factorial(5)", entry: "factorial", input: "[5]", code: `function factorial(n) {\n  if (n <= 1) {\n    return 1;\n  }\n  return n * factorial(n - 1);\n}\n` },
  ],
} as const;

export function CodePanel({ projectId, onTraced }: { projectId: string; onTraced: (revision?: number) => void }) {
  const { run, busy } = usePending();
  const [language, setLanguage] = useState<"python" | "javascript">("python");
  const [code, setCode] = useState<string>(SAMPLES.python[0].code);
  const [entry, setEntry] = useState<string>(SAMPLES.python[0].entry);
  const [input, setInput] = useState<string>(SAMPLES.python[0].input);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ trace: { language: "python" | "javascript"; entry: string; input: unknown; code: string; returned: unknown; summary: { callCount: number; maxDepth: number; steps?: number } } | null }>(`/api/projects/${projectId}/traces`).then((res) => {
      if (!res.ok || !res.data.trace) return;
      const t = res.data.trace;
      setLanguage(t.language); setCode(t.code ?? ""); setEntry(t.entry); setInput(JSON.stringify(t.input));
      setSummary(`Saved trace: ${t.summary.callCount} calls, depth ${t.summary.maxDepth}, returned ${JSON.stringify(t.returned)}.`);
    });
  }, [projectId]);

  const pick = (lang: "python" | "javascript", sample: (typeof SAMPLES)["python"][number] | (typeof SAMPLES)["javascript"][number]) => { setLanguage(lang); setCode(sample.code); setEntry(sample.entry); setInput(sample.input); setSummary(""); setError(""); };

  const trace = () => run("trace", async () => {
    setError(""); setSummary("");
    let args: unknown;
    try { args = JSON.parse(input); } catch { setError("Inputs must be a JSON list, like [[1, 2, 3], 2]."); return; }
    if (!Array.isArray(args)) { setError("Inputs must be a JSON list of arguments, like [5]."); return; }
    try {
      const traced = await runBrowserTrace(code, entry.trim(), args, language);
      const res = await api<{ trace: { summary: { callCount: number; maxDepth: number } }; revision?: number }>(`/api/projects/${projectId}/traces`, { body: { language, code, entry: entry.trim(), input: args, returned: traced.returned, tracerVersion: "leela-trace@2", steps: traced.steps, summary: traced.summary } });
      if (!res.ok) { setError(res.error); return; }
      setSummary(`${traced.summary.callCount} calls, depth ${traced.summary.maxDepth}, ${traced.steps.length} steps, returned ${JSON.stringify(traced.returned)}. Saved. Plan the storyboard next.`);
      onTraced(res.data.revision);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The trace stopped.");
    }
  });

  return (
    <Panel kicker="Runs in your browser" title="Trace the code">
      <p className="fine">Your code runs only here, in a sandboxed worker (5 seconds, 2,000 steps). The film shows what really happened, step by step.</p>
      <div className="row-actions">
        <div className="chips" role="radiogroup" aria-label="Language">
          {(["python", "javascript"] as const).map((lang) => <button key={lang} type="button" role="radio" aria-checked={language === lang} className={language === lang ? "chip is-on" : "chip"} onClick={() => pick(lang, SAMPLES[lang][0])}>{lang === "python" ? "Python" : "JavaScript"}</button>)}
        </div>
        <div className="chips" aria-label="Examples">
          {SAMPLES[language].map((sample) => <button key={sample.id} type="button" className="chip" onClick={() => pick(language, sample)}>{sample.label}</button>)}
        </div>
      </div>
      <textarea className="field mono code" aria-label={`${language} code`} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
      <div className="split">
        <label className="stack-label">Function to run<input className="field mono" value={entry} onChange={(e) => setEntry(e.target.value)} aria-label="Function to run" />
        </label>
        <label className="stack-label">Inputs (JSON list of arguments)<input className="field mono" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Inputs" />
        </label>
      </div>
      <Button pending={busy("trace")} onClick={() => void trace()}>Trace</Button>
      {summary ? <p className="ok" role="status">{summary}</p> : null}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

/* --------------------------------------------------------------------- cast */

type Character = { id: string; name: string; description: string; sheetUrl: string | null; look: { skin: string; top: string; hair: string } };

export function CastPanel({ project, onChange }: { project: ProjectView; onChange: (castIds: string[]) => void }) {
  const [items, setItems] = useState<Character[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = project.castIds;
  useEffect(() => { void api<{ items: Character[] }>("/api/characters").then((res) => setItems(res.ok ? res.data.items : [])); }, []);

  async function toggle(id: string) {
    if (saving) return;
    const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id].slice(0, 6);
    setSaving(true);
    setError("");
    const res = await api(`/api/projects/${project.id}`, { method: "PATCH", body: { castIds: next } });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onChange(next);
  }

  return (
    <Panel kicker="Cast" title="Who is in it" actions={<a className="btn ghost sm" href="/studio/library?tab=characters">Make a character</a>}>
      {project.seriesId ? <p className="fine">This episode uses the cast frozen in its series version.</p> : null}
      {items === null ? <p className="fine">Loading characters</p> : items.length === 0 ? <p className="fine">No characters yet. Without a cast, two friendly default performers play the story.</p> : (
        <div className="cast-pick" aria-busy={saving}>
          {items.map((item) => (
            <label key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)} disabled={saving} onChange={() => void toggle(item.id)} />
              {item.sheetUrl ? <img src={item.sheetUrl} alt="" /> : <span className="ph swatch" style={{ background: `linear-gradient(${item.look.hair} 0 30%, ${item.look.skin} 30% 55%, ${item.look.top} 55%)` }} />}
              <span>{item.name}</span>
            </label>
          ))}
        </div>
      )}
      <p className="fine">The first three picked perform on the 3D stage, in this order. The planner writes them into the beats.</p>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

/* ------------------------------------------------------------------- lyrics */

export function LyricsPanel({ project, revision, onBuilt }: { project: ProjectView; revision: number; onBuilt: () => Promise<void> }) {
  const { run, busy } = usePending();
  const [song, setSong] = useState<string[]>(project.lyrics?.songAssetId ? [project.lyrics.songAssetId] : []);
  const [lrc, setLrc] = useState(project.lyrics?.lrc ?? "");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const build = () => run("build", async () => {
    setError(""); setStatus("");
    const res = await api<{ lines: number; scenes: number }>(`/api/projects/${project.id}/lyrics`, { body: { songAssetId: song[0], lrc, expectedRevision: revision } });
    if (!res.ok) { setError(res.error); return; }
    setStatus(`${res.data.lines} lines across ${res.data.scenes} scenes, timed from your file.`);
    await onBuilt();
  });

  return (
    <Panel kicker="Lyrics" title="Song and timed words">
      <AssetPicker kinds={["audio"]} value={song} onChange={(ids) => setSong(ids)} label="Song" uploadLabel="Upload song" />
      <label className="stack-label">Timed lyrics (LRC)<textarea className="field mono" aria-label="Timed lyrics" value={lrc} onChange={(e) => setLrc(e.target.value)} placeholder={"[00:01.20] First line\n[00:04.80] Second line"} style={{ minHeight: 180 }} />
      </label>
      <p className="fine">Each line appears when it is sung, over a coloured stage that pulses with the song. Times come from your file, never guessed.</p>
      <Button pending={busy("build")} disabled={!song[0] || lrc.trim().length < 8} onClick={() => void build()}>Build lyric storyboard</Button>
      {status ? <p className="ok" role="status">{status}</p> : null}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}

/* --------------------------------------------------------------------- reel */

export function ReelPanel({ project, catalog, disabled, onQueued }: { project: ProjectView; catalog: Catalog | null; disabled: boolean; onQueued: (jobId: string) => void }) {
  const { run, busy } = usePending();
  const saved = (project.montage?.reel ?? {}) as { assetId?: string; source?: "auto" | "text"; text?: string; style?: "phrase" | "punchy" | "karaoke"; band?: string; language?: string };
  const auto = Boolean(catalog?.captions.transcription);
  const [reel, setReel] = useState<string[]>(saved.assetId ? [saved.assetId] : []);
  const [source, setSource] = useState<"auto" | "text">(saved.source ?? (auto ? "auto" : "text"));
  const [text, setText] = useState(saved.text ?? "");
  const [style, setStyle] = useState<"phrase" | "punchy" | "karaoke">(saved.style ?? "phrase");
  const [band, setBand] = useState(saved.band ?? "auto");
  const [language, setLanguage] = useState(saved.language ?? "auto");
  const [error, setError] = useState("");

  const go = () => run("go", async () => {
    setError("");
    const karaoke = style === "karaoke";
    const res = await api<{ jobId: string }>(`/api/projects/${project.id}/captions`, { body: { assetId: reel[0], source: karaoke ? (auto ? "auto" : "text") : source, text, style, band: karaoke && !["upper", "lower", "above-head"].includes(band) ? "above-head" : band, language: karaoke && language === "auto" ? "hi" : language } });
    if (!res.ok) { setError(res.error); return; }
    onQueued(res.data.jobId);
  });

  return (
    <Panel kicker="Caption a reel" title="Your reel, with captions that land on the words">
      <AssetPicker kinds={["video"]} value={reel} onChange={(ids) => setReel(ids)} label="Reel (MP4, up to 3 minutes)" uploadLabel="Upload reel" />
      <div className="stack-label">
        <span className="stack-label-text">Kind of captions</span>
        <div className="chips" role="radiogroup" aria-label="Caption style">
          <button type="button" role="radio" aria-checked={style === "phrase"} className={style === "phrase" ? "chip is-on" : "chip"} onClick={() => setStyle("phrase")}>Phrases</button>
          <button type="button" role="radio" aria-checked={style === "punchy"} className={style === "punchy" ? "chip is-on" : "chip"} onClick={() => setStyle("punchy")}>Punchy, 2 to 3 words</button>
          <button type="button" role="radio" aria-checked={style === "karaoke"} className={style === "karaoke" ? "chip is-on" : "chip"} onClick={() => { setStyle("karaoke"); setBand("above-head"); }}>Karaoke lyrics (singing)</button>
        </div>
      </div>
      {style === "karaoke" ? (
        <>
          <label className="stack-label">Lyrics you sing, one line per row. Times are optional.
            <textarea aria-label="Lyrics" className="field mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={auto ? "Leave this empty and we listen to the reel.\nOr paste the words, one line per row." : "kuch bhi nahin hai ye jahaan\ntu jo nahin to mera kuch nahin hai"} style={{ minHeight: 180 }} />
          </label>
          <p className="fine">{auto ? "Paste the words if you want those exact lines. Leave the box empty and the studio listens to the reel. Add [00:12.00] only when a line must start at that moment." : "Paste the words, one line per row. Add [00:12.00] times if you want a line to start at that moment. Transcription is not set up, so the words are required."} The line sits in gold with a dark edge. Unsung words stay readable and brighten as they are sung.</p>
          <div className="stack-label">
            <span className="stack-label-text">Where the lyrics sit</span>
            <div className="chips" role="radiogroup" aria-label="Lyric position">
              {[["above-head", "Above my head"], ["upper", "Top"], ["lower", "Bottom"]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={band === id} className={band === id ? "chip is-on" : "chip"} onClick={() => setBand(id)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="stack-label">Sung language
            <select aria-label="Sung language" className="field field-sm" value={language === "auto" ? "hi" : language} onChange={(e) => setLanguage(e.target.value)}><option value="hi">Hindi or Hinglish</option><option value="en">English</option></select>
          </label>
        </>
      ) : (
        <>
          <div className="stack-label">
            <span className="stack-label-text">Word timing</span>
            <div className="chips" role="radiogroup" aria-label="Word timing">
              <button type="button" role="radio" aria-checked={source === "auto"} className={source === "auto" ? "chip is-on" : "chip"} disabled={!auto} title={auto ? undefined : catalog?.captions.reason} onClick={() => setSource("auto")}>Listen to the reel</button>
              <button type="button" role="radio" aria-checked={source === "text"} className={source === "text" ? "chip is-on" : "chip"} onClick={() => setSource("text")}>I will paste captions</button>
            </div>
            {!auto ? <p className="fine">{catalog?.captions.reason}</p> : null}
          </div>
          {source === "text" ? (
            <label className="stack-label">Captions: SRT, LRC, or plain lines
              <textarea aria-label="Captions: SRT, LRC, or plain lines" className="field mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={"1\n00:00:00,500 --> 00:00:02,000\nHello there"} style={{ minHeight: 160 }} />
            </label>
          ) : (
            <label className="stack-label">Spoken language
              <select aria-label="Spoken language" className="field field-sm" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="auto">Detect</option><option value="en">English</option><option value="hi">Hindi or Hinglish</option></select>
            </label>
          )}
          <div className="stack-label">
            <span className="stack-label-text">Where captions go</span>
            <div className="chips" role="radiogroup" aria-label="Caption position">
              {[["auto", "Find a clear spot"], ["upper", "Top"], ["middle", "Middle"], ["lower", "Bottom"]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={band === id} className={band === id ? "chip is-on" : "chip"} disabled={id === "auto" && !catalog?.captions.autoPlacement} onClick={() => setBand(id)}>{label}</button>
              ))}
            </div>
          </div>
        </>
      )}
      <Button tone="accent" pending={busy("go")} disabled={disabled || !reel[0] || (style === "karaoke" ? !text.trim() && !auto : source === "text" && !text.trim())} onClick={() => void go()}>{style === "karaoke" ? "Make my lyric video" : "Caption my reel"}</Button>
      <p className="fine">The original stays untouched. The result is a new film version you can watch, download and share.</p>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}
