"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { validatePlan } from "../../contracts/plan";
import { BriefPanel } from "./brief-panel";
import { CastPanel } from "./cast-panel";
import { FilmPanel, SharePanel, type VideoItem } from "./film-panel";
import { LyricsPanel } from "./lyrics-panel";
import { MontagePanel } from "./montage-panel";
import { StudioBar } from "./studio-bar";
import { runBrowserTrace } from "../../trace/browser-client";

type Idea = { topic?: string; audience?: string; notes?: string };
type Line = { id: string; text: string; spoken?: string };
type Scene = { id: string; purpose: string; lines: Line[]; layers: { component: string; props?: { action?: string } }[] };
type Plan = { title?: string; scenes: Scene[]; language?: string; format?: string; mode?: string };
type Settings = { format: string; language: string; targetMs: number };
type Angle = { title: string; hook: string; takeaway: string };
type Note = { id: string; role: string; text: string; candidate?: { summary?: string; status?: string } };
type Voice = { id: string; label: string; available: boolean; reason?: string; timing: string; commercial: boolean; note: string; languages?: string[] };
type JobView = { id: string; output: "mp4" | "preview"; state: string; stages: { name: string; state: string }[]; error?: { message?: string } };
type Step = "idea" | "storyboard" | "film" | "share";

const STEPS: { id: Step; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "storyboard", label: "Storyboard" },
  { id: "film", label: "Film" },
  { id: "share", label: "Share" },
];

const STAGE_LABEL: Record<string, string> = {
  voice: "Recording narration",
  timeline: "Timing scenes to the voice",
  frames: "Drawing frames",
  mix: "Mixing sound, captions and poster",
  qa: "Checking the file",
  preview: "Building the preview",
  beats: "Finding the beats",
  cuts: "Cutting clips to the beat",
};

const SEARCH = `def binary_search(arr, target):
  lo = 0
  hi = len(arr) - 1
  while lo <= hi:
    mid = (lo + hi) // 2
    if arr[mid] == target:
      return mid
    if arr[mid] < target:
      lo = mid + 1
    else:
      hi = mid - 1
  return -1
`;

const FIB = `def fib(n):
  if n <= 1:
    return n
  return fib(n - 1) + fib(n - 2)
`;

export function Workspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("idea");
  const [mode, setMode] = useState("");
  const [badge, setBadge] = useState("draft");
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState<Idea>({});
  const [revision, setRevision] = useState(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planHash, setPlanHash] = useState("");
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [copilot, setCopilot] = useState("");
  const [focusScenes, setFocusScenes] = useState<string[]>([]);
  const [code, setCode] = useState(SEARCH);
  const [entry, setEntry] = useState("binary_search");
  const [traceError, setTraceError] = useState("");
  const [traceSummary, setTraceSummary] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [settings, setSettings] = useState<Settings>({ format: "9x16", language: "en", targetMs: 45000 });
  const [castIds, setCastIds] = useState<string[]>([]);
  const [lrc, setLrc] = useState("");
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const polling = useRef("");

  const loadVideos = useCallback(async () => {
    const response = await fetch(`/api/projects/${params.id}/videos`);
    if (!response.ok) return [] as VideoItem[];
    const body = await response.json();
    setVideos(body.items || []);
    return (body.items || []) as VideoItem[];
  }, [params.id]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${params.id}`);
    if (response.status === 401) {
      router.replace("/sign-in");
      return null;
    }
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not open that project.");
      return null;
    }
    setMode(body.project.mode);
    setTitle(body.project.title);
    setBadge(body.project.badge);
    setVoiceId(body.project.voiceId);
    setSettings({ format: body.project.format, language: body.project.language, targetMs: body.project.targetMs });
    setCastIds(body.project.castIds || []);
    setLrc(body.project.lyrics?.lrc || "");
    setIdea(body.draft?.idea || {});
    setRevision(body.draft?.revision || 1);
    setPlan(body.draft?.plan ?? null);
    setPlanHash(body.draft?.planValid ? body.draft.planHash || "" : "");
    setIssues(body.draft?.planValid ? [] : body.draft?.issues || []);
    if (body.video?.id) setSelectedVideo((current) => current || body.video.id);
    return body;
  }, [params.id, router]);

  useEffect(() => {
    void (async () => {
      const body = await load();
      await loadVideos();
      if (body?.activeJob?.id) void follow(body.activeJob.id, body.activeJob.output);
    })();
    fetch(`/api/projects/${params.id}/messages`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setNotes(body.items || []);
    });
    fetch("/api/catalog").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setVoices(body.voices || []);
    });
    // follow is stable for this page; load/loadVideos change only with the project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function renameProject(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`/api/projects/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not rename the project.");
      return;
    }
    setTitle(body.project.title);
    setStatus("Project renamed");
  }

  async function chooseVoice(id: string) {
    setError("");
    const response = await fetch(`/api/projects/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: id }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not change the narrator.");
      return;
    }
    setVoiceId(body.project.voiceId);
    setSettings({ format: body.project.format, language: body.project.language, targetMs: body.project.targetMs });
    setStatus("Narrator saved");
  }

  async function changeSettings(next: Partial<Settings>) {
    setError("");
    const response = await fetch(`/api/projects/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not change the settings.");
      return;
    }
    setSettings({ format: body.project.format, language: body.project.language, targetMs: body.project.targetMs });
    if (body.draftRevision) await load();
    setStatus("Settings saved");
  }

  async function saveIdea() {
    setStatus("Saving");
    const response = await fetch(`/api/projects/${params.id}/draft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision, idea }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not save.");
      setStatus("");
      return false;
    }
    setRevision(body.revision);
    setStatus("Saved");
    return true;
  }

  async function brainstorm() {
    setError("");
    if (!(await saveIdea())) return;
    setBusy(true);
    setStatus("Thinking of angles");
    const response = await fetch(`/api/projects/${params.id}/brainstorm`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body?.error?.message || "Could not brainstorm.");
      setStatus("");
      return;
    }
    setAngles(body.result?.angles || []);
    setStatus("Angles ready");
  }

  async function planStory() {
    setError("");
    if (!(await saveIdea())) return;
    setBusy(true);
    setStatus("Planning the storyboard");
    const response = await fetch(`/api/projects/${params.id}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body?.error?.message || "Could not plan.");
      setStatus("");
      return;
    }
    await load();
    setStep("storyboard");
    setStatus("Storyboard ready");
  }

  async function trace() {
    setTraceError("");
    try {
      const input = entry === "fib" ? [4] : [[4, 9, 15, 21, 28, 33], 21];
      const traced = await runBrowserTrace(code, entry, input);
      setTraceSummary(`${traced.summary.callCount} calls, depth ${traced.summary.maxDepth}, returned ${traced.returned}`);
      const response = await fetch(`/api/projects/${params.id}/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "python", code, entry, input, returned: traced.returned, tracerVersion: "leela-trace@1", steps: traced.steps, summary: traced.summary }),
      });
      const body = await response.json();
      if (!response.ok) setTraceError(body?.error?.message || "Could not save the trace.");
    } catch (caught) {
      setTraceError(caught instanceof Error ? caught.message : "The trace stopped.");
    }
  }

  function editLine(sceneId: string, lineId: string, text: string) {
    if (!plan) return;
    setPlanHash("");
    setPlan({
      ...plan,
      scenes: plan.scenes.map((scene) => scene.id === sceneId ? { ...scene, lines: scene.lines.map((line) => line.id === lineId ? { ...line, text } : line) } : scene),
    });
  }

  async function importStoryboard(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > 1024 * 1024) {
      setError("Choose a storyboard JSON file smaller than 1 MB.");
      return;
    }
    try {
      const checked = validatePlan(JSON.parse(await file.text()));
      if (!checked.plan) {
        setError(checked.issues.slice(0, 3).map((issue) => issue.path + " " + issue.message).join(". "));
        return;
      }
      setPlan(checked.plan);
      setPlanHash("");
      setStatus("Storyboard imported. Save edits to approve it.");
    } catch {
      setError("Could not read that storyboard JSON file.");
    }
  }

  async function savePlan() {
    setError("");
    const response = await fetch(`/api/projects/${params.id}/draft`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision, plan }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not save the storyboard.");
      return;
    }
    setRevision(body.revision);
    setPlanHash(body.planValid ? body.planHash || "" : "");
    setIssues(body.planValid ? [] : body.issues || []);
    setStatus(body.planValid ? "Storyboard saved" : "Saved, but the storyboard is not valid yet");
  }

  async function follow(jobId: string, output: "mp4" | "preview") {
    if (polling.current === jobId) return;
    polling.current = jobId;
    setBusy(true);
    setStatus(output === "mp4" ? "Rendering the film" : "Preparing preview");
    // Poll the real job state. There is no invented progress.
    for (let attempt = 0; attempt < 1800 && polling.current === jobId; attempt++) {
      const response = await fetch(`/api/jobs/${jobId}`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setError(body?.error?.message || "Lost track of the job. Reload the page.");
        break;
      }
      setJob({ id: jobId, output, state: body.state, stages: body.stages || [], error: body.error });
      if (body.state === "succeeded") {
        const list = await loadVideos();
        await load();
        const made = body.result?.videoId ? String(body.result.videoId) : list[0]?.id;
        if (made) setSelectedVideo(made);
        setStep("film");
        const passed = body.result?.qaPassed !== false;
        setStatus(output === "mp4" ? (passed ? "Film ready" : "Render finished but did not pass QA") : "Preview ready");
        setJob(null);
        break;
      }
      if (body.state === "failed" || body.state === "cancelled") {
        setStatus(body.state === "cancelled" ? (output === "mp4" ? "Render cancelled" : "Preview cancelled") : "");
        if (body.state === "failed") setError(body.error?.message || "The job failed.");
        await load();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt < 10 ? 700 : 1500));
    }
    if (polling.current === jobId) polling.current = "";
    setBusy(false);
  }

  async function approve(output: "mp4" | "preview") {
    setError("");
    setStatus(output === "mp4" ? "Approving the storyboard" : "Preparing preview");
    const response = await fetch(`/api/projects/${params.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftRevision: revision, planHash, output }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not approve.");
      setStatus("");
      if (body?.error?.details?.activeJobId) void follow(body.error.details.activeJobId, output);
      return;
    }
    setJob({ id: body.jobId, output, state: "queued", stages: [] });
    await follow(body.jobId, output);
  }

  async function changeJob(action: "cancel" | "retry") {
    if (!job) return;
    const current = job;
    const response = await fetch(`/api/jobs/${current.id}/${action}`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not update the job.");
      return;
    }
    if (action === "cancel") {
      polling.current = "";
      setJob({ ...current, state: "cancelled" });
      setStatus(current.output === "mp4" ? "Render cancelled" : "Preview cancelled");
      setBusy(false);
      return;
    }
    setError("");
    await follow(current.id, current.output);
  }

  async function refreshNotes() {
    const list = await fetch(`/api/projects/${params.id}/messages`);
    const notesBody = await list.json();
    setNotes(notesBody.items || []);
  }

  async function ask() {
    setError("");
    setBusy(true);
    const response = await fetch(`/api/projects/${params.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: copilot, sceneIds: focusScenes }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body?.error?.message || "The copilot could not answer.");
      return;
    }
    setCopilot("");
    await refreshNotes();
  }

  async function decide(id: string, action: "keep" | "discard") {
    const response = await fetch(`/api/messages/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "keep" ? { expectedRevision: revision } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error?.message || `Could not ${action} that.`);
      return;
    }
    await load();
    await refreshNotes();
    setStatus(action === "keep" ? "Change kept" : "Change discarded");
  }

  const selected = videos.find((item) => item.id === selectedVideo) ?? videos[0];
  const voice = voices.find((item) => item.id === voiceId);
  const jobActive = Boolean(job && ["queued", "running", "waiting_quota"].includes(job.state));

  return (
    <main className="app studio">
      <StudioBar status={status} />
      <div className="ws-head">
        <form className="ws-title" onSubmit={renameProject}>
          <input className="field" value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} aria-label="Title" />
          <button className="btn ghost sm" type="submit" disabled={!title.trim()}>Rename</button>
          <span className="badge" data-tone={badge}>{badge}</span>
        </form>
        <nav className="steps-nav" aria-label="Project steps">
          {STEPS.map((item, index) => (
            <button key={item.id} className={step === item.id ? "is-on" : ""} type="button" aria-label={item.label} aria-current={step === item.id ? "step" : undefined} onClick={() => setStep(item.id)}>
              <span className="n" aria-hidden="true">{index + 1}</span>{item.label}
            </button>
          ))}
        </nav>
      </div>
      {error ? <p className="notice bad" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      <div className="studio-grid">
        <section>
          {step === "idea" ? (
            <>
              <div className="surface panel">
                <div>
                  <p className="kicker">{({ code_lab: "Code Lab", audio: "Audio", montage: "Montage", story: "Story", cartoon: "Cartoon", lyrics: "Lyrics" } as Record<string, string>)[mode] ?? "Explainer"}</p>
                  <h2>What is this film about?</h2>
                </div>
                <label className="stack-label">Topic
                  <textarea className="field" value={idea.topic || ""} onChange={(event) => setIdea({ ...idea, topic: event.target.value })} placeholder="Topic" />
                </label>
                <label className="stack-label">Who is it for
                  <input className="field" value={idea.audience || ""} onChange={(event) => setIdea({ ...idea, audience: event.target.value })} placeholder="Audience" />
                </label>
                <div className="split" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <label className="stack-label">Format
                    <select className="field" aria-label="Format" value={settings.format} onChange={(event) => void changeSettings({ format: event.target.value })}>
                      <option value="9x16">Vertical 9:16</option>
                      <option value="16x9">Landscape 16:9</option>
                      <option value="1x1">Square 1:1</option>
                    </select>
                  </label>
                  <label className="stack-label">Language
                    <select className="field" aria-label="Language" value={settings.language} onChange={(event) => void changeSettings({ language: event.target.value })}>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                      <option value="hinglish">Hinglish</option>
                    </select>
                  </label>
                  <label className="stack-label">Length
                    <select className="field" aria-label="Length" value={settings.targetMs} onChange={(event) => void changeSettings({ targetMs: Number(event.target.value) })}>
                      {[15000, 30000, 45000, 60000, 90000, 120000, 180000].map((ms) => <option key={ms} value={ms}>{ms < 60000 ? `${ms / 1000} seconds` : `${ms / 60000} min`}</option>)}
                    </select>
                  </label>
                </div>
                {plan?.language && plan.language !== settings.language ? <p className="notice warn">The storyboard is in {plan.language === "hi" ? "Hindi" : plan.language === "hinglish" ? "Hinglish" : "English"}. Plan it again to switch language.</p> : null}
                <div className="row-actions">
                  <button className="btn ghost" type="button" onClick={() => void saveIdea()}>Save</button>
                  {mode !== "lyrics" && mode !== "montage" ? <button className="btn ghost" type="button" disabled={busy} onClick={() => void brainstorm()}>Brainstorm</button> : null}
                  {mode !== "lyrics" && mode !== "montage" ? <button className="btn" type="button" disabled={busy} onClick={() => void planStory()}>Plan storyboard</button> : null}
                </div>
                {angles.length ? (
                  <div className="cards" aria-label="Angles">
                    {angles.map((angle) => (
                      <button key={angle.title} className="surface card" type="button" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setIdea({ ...idea, topic: `${angle.title}. ${angle.hook} ${angle.takeaway}` })}>
                        <strong style={{ fontWeight: 500 }}>{angle.title}</strong>
                        <span className="muted">{angle.hook}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {mode === "montage" ? (
                <MontagePanel projectId={params.id} disabled={jobActive} onQueued={(jobId) => { setJob({ id: jobId, output: "mp4", state: "queued", stages: [] }); void follow(jobId, "mp4"); }} />
              ) : mode === "lyrics" ? (
                <LyricsPanel projectId={params.id} revision={revision} initialLrc={lrc} onBuilt={async () => { await load(); setStep("storyboard"); }} />
              ) : <BriefPanel projectId={params.id} suggestedRequest={idea.topic || ""} audience={idea.audience} />}
              {mode === "story" || mode === "cartoon" ? <CastPanel projectId={params.id} selected={castIds} onChange={setCastIds} /> : null}
              {mode === "montage" && job ? (
                <div className="surface panel progress" aria-live="polite">
                  <p className="kicker">Montage · {job.state}</p>
                  {job.stages.length ? <ol>{job.stages.map((stage) => <li key={stage.name} data-state={stage.state}>{STAGE_LABEL[stage.name] ?? stage.name}</li>)}</ol> : null}
                </div>
              ) : null}
              {mode === "code_lab" ? (
                <div className="surface panel">
                  <div>
                    <p className="kicker">Runs in your browser</p>
                    <h2>Trace the code</h2>
                  </div>
                  <div className="chips">
                    <button className={entry === "binary_search" ? "chip is-on" : "chip"} type="button" onClick={() => { setCode(SEARCH); setEntry("binary_search"); }}>Binary search</button>
                    <button className={entry === "fib" ? "chip is-on" : "chip"} type="button" onClick={() => { setCode(FIB); setEntry("fib"); }}>fib(4)</button>
                  </div>
                  <textarea className="field mono" aria-label="Python code" value={code} onChange={(event) => setCode(event.target.value)} style={{ minHeight: 220, fontSize: 13 }} />
                  <button className="btn" type="button" onClick={() => void trace()}>Trace</button>
                  {traceSummary ? <p className="ok" role="status">{traceSummary}</p> : null}
                  {traceError ? <p className="error">{traceError}</p> : null}
                </div>
              ) : null}
            </>
          ) : null}

          {step === "storyboard" ? (
            <>
              <div className="surface panel">
                <div className="row-actions" style={{ justifyContent: "space-between" }}>
                  <div>
                    <p className="kicker">Revision {revision}</p>
                    <h2>{plan?.title || "Storyboard"}</h2>
                  </div>
                  <label className="fine">Import a storyboard JSON file
                    <input type="file" accept=".json,application/json" onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void importStoryboard(file);
                    }} />
                  </label>
                </div>
                {issues.length ? (
                  <div className="notice bad">
                    {issues.slice(0, 5).map((issue) => <div key={issue.path + issue.message}>{issue.path}: {issue.message}</div>)}
                  </div>
                ) : null}
                {plan?.scenes?.length ? plan.scenes.map((scene) => (
                  <article key={scene.id} className="raised scene">
                    <div className="scene-head">
                      <label className="row-actions" style={{ gap: 8 }}>
                        <input type="checkbox" aria-label={`Ask the copilot about ${scene.id}`} checked={focusScenes.includes(scene.id)} onChange={(event) => setFocusScenes((current) => event.target.checked ? [...current, scene.id] : current.filter((id) => id !== scene.id))} />
                        <strong style={{ fontWeight: 500 }}>{scene.id.toUpperCase()} · {scene.purpose}</strong>
                      </label>
                      <span>{scene.layers.map((layer) => layer.props?.action ? `${layer.component.replace(/@\d+$/, "")} · ${layer.props.action}` : layer.component.replace(/@\d+$/, "")).join(", ")}</span>
                    </div>
                    {scene.lines.map((line) => (
                      <textarea key={line.id} className="field" aria-label={`Narration for ${scene.id} ${line.id}`} value={line.text} onChange={(event) => editLine(scene.id, line.id, event.target.value)} />
                    ))}
                  </article>
                )) : <p className="empty">Plan a storyboard from the idea step, or import an authored JSON file.</p>}
                <div className="row-actions">
                  <button className="btn ghost" type="button" onClick={() => void savePlan()} disabled={!plan}>Save edits</button>
                </div>
              </div>

              <div className="surface panel">
                <div>
                  <p className="kicker">Approve</p>
                  <h2>Render</h2>
                </div>
                <label className="stack-label">Narrator
                  <select className="field" value={voiceId} onChange={(event) => void chooseVoice(event.target.value)} aria-label="Narrator">
                    {voices.map((item) => {
                      const speaks = !item.languages || item.languages.includes(plan?.language ?? settings.language);
                      return <option key={item.id} value={item.id} disabled={!item.available || !speaks}>{item.label}{!item.available ? " (not configured)" : !speaks ? " (other language)" : ""}</option>;
                    })}
                  </select>
                </label>
                {voice ? <p className="fine">{voice.note}</p> : null}
                <div className="row-actions">
                  <button className="btn accent" type="button" onClick={() => void approve("mp4")} disabled={!planHash || jobActive || !voice?.available}>Approve and render film</button>
                  <button className="btn ghost" type="button" onClick={() => void approve("preview")} disabled={!planHash || jobActive}>Approve and preview</button>
                </div>
                {!planHash && plan ? <p className="fine">Save a valid storyboard to approve it.</p> : null}
                {job ? (
                  <div className="progress" aria-live="polite">
                    <p className="kicker">{job.output === "mp4" ? "Film render" : "Preview"} · {job.state}</p>
                    {job.stages.length ? (
                      <ol>
                        {job.stages.map((stage) => <li key={stage.name} data-state={stage.state}>{STAGE_LABEL[stage.name] ?? stage.name}</li>)}
                      </ol>
                    ) : null}
                    <div className="row-actions">
                      {jobActive ? <button className="btn ghost sm" type="button" onClick={() => void changeJob("cancel")}>{job.output === "mp4" ? "Cancel render" : "Cancel preview"}</button> : null}
                      {job.state === "failed" || job.state === "cancelled" ? <button className="btn ghost sm" type="button" onClick={() => void changeJob("retry")}>{job.output === "mp4" ? "Retry render" : "Retry preview"}</button> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {step === "film" ? <FilmPanel videos={videos} selectedId={selected?.id ?? ""} onSelect={setSelectedVideo} /> : null}
          {step === "share" ? <SharePanel key={selected?.id ?? "none"} video={selected} /> : null}
        </section>

        <aside className="surface dock" aria-label="Copilot">
          <div>
            <p className="kicker">Copilot</p>
            <h3>Ask for a change</h3>
          </div>
          <div className="notes">
            {notes.length === 0 ? <p className="fine">Try “Make it slower” or “Make the ending punchier”. Changes arrive as a proposal you can keep or discard.</p> : null}
            {notes.map((note) => (
              <div key={note.id} className="note">
                <strong>{note.role}</strong>
                <p>{note.text}</p>
                {note.candidate?.status === "proposed" ? (
                  <div className="row-actions" style={{ marginTop: 8 }}>
                    <button className="btn sm" type="button" onClick={() => void decide(note.id, "keep")}>Keep</button>
                    <button className="btn ghost sm" type="button" onClick={() => void decide(note.id, "discard")}>Discard</button>
                  </div>
                ) : note.candidate?.status ? <p className="fine">{note.candidate.status}</p> : null}
              </div>
            ))}
          </div>
          <p className="fine">{focusScenes.length ? `Only ${focusScenes.join(", ")} will change.` : "Tick scenes in the storyboard to limit a change to them."}</p>
          <textarea className="field" aria-label="Message to the copilot" value={copilot} onChange={(event) => setCopilot(event.target.value)} placeholder="Make it slower" style={{ minHeight: 80 }} />
          <button className="btn" type="button" disabled={!copilot.trim() || busy} onClick={() => void ask()}>Send</button>
        </aside>
      </div>
    </main>
  );
}
