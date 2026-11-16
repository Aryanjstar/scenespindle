"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { validatePlan } from "../../contracts/plan";
import { Brand } from "../brand";
import { BriefPanel } from "./brief-panel";
import { runBrowserTrace } from "../../trace/browser-client";

type Idea = { topic?: string; audience?: string; notes?: string };
type Scene = { id: string; purpose: string; lines: { id: string; text: string }[]; layers: { component: string }[] };
type Plan = { title?: string; scenes: Scene[]; planHash?: string };
type Angle = { title: string; hook: string; takeaway: string };
type Note = { id: string; role: string; text: string; candidate?: { summary?: string; status?: string } };

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
  const [step, setStep] = useState<"idea" | "storyboard" | "video" | "share">("idea");
  const [mode, setMode] = useState("");
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState<Idea>({});
  const [revision, setRevision] = useState(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planHash, setPlanHash] = useState("");
  const [angles, setAngles] = useState<Angle[]>([]);
  const [videoId, setVideoId] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [copilot, setCopilot] = useState("");
  const [code, setCode] = useState(SEARCH);
  const [entry, setEntry] = useState("binary_search");
  const [traceError, setTraceError] = useState("");
  const [traceSummary, setTraceSummary] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [previewJobId, setPreviewJobId] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [mouth, setMouth] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${params.id}`);
    if (response.status === 401) {
      router.replace("/sign-in");
      return;
    }
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not open that project.");
      return;
    }
    setMode(body.project.mode);
    setTitle(body.project.title);
    setIdea(body.draft?.idea || {});
    setRevision(body.draft?.revision || 1);
    setPlan(body.draft?.planValid ? body.draft.plan : null);
    setPlanHash(body.draft?.planHash || "");
    if (body.video?.id) {
      setVideoId(body.video.id);
      setWarnings(body.video.warnings || []);
    }
  }, [params.id, router]);

  useEffect(() => {
    // Fetch completion updates state asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    fetch(`/api/projects/${params.id}/messages`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setNotes(body.items || []);
    });
  }, [params.id, load]);

  useEffect(() => {
    if (mode !== "cartoon") return;
    const timer = setInterval(() => setMouth((value) => (value + 1) % 3), 180);
    return () => clearInterval(timer);
  }, [mode]);

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
    const response = await fetch(`/api/projects/${params.id}/brainstorm`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not brainstorm.");
      return;
    }
    setAngles(body.result?.angles || []);
  }

  async function planStory() {
    setError("");
    setStatus("Planning");
    if (!(await saveIdea())) return;
    const response = await fetch(`/api/projects/${params.id}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
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
        body: JSON.stringify({ language: "python", code, entry, input, tracerVersion: "leela-trace@1", steps: traced.steps, summary: traced.summary }),
      });
      const body = await response.json();
      if (!response.ok) setTraceError(body?.error?.message || "Could not save the trace.");
    } catch (caught) {
      setTraceError(caught instanceof Error ? caught.message : "The trace stopped.");
    }
  }

  function editLine(sceneId: string, text: string) {
    if (!plan) return;
    setPlanHash("");
    setPlan({
      ...plan,
      scenes: plan.scenes.map((scene) => scene.id === sceneId ? { ...scene, lines: scene.lines.map((line, index) => index === 0 ? { ...line, text } : line) } : scene),
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
        setError(checked.issues.slice(0, 3).map(issue => issue.path + " " + issue.message).join(". "));
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
    setPlanHash(body.planHash || "");
    setStatus(body.planValid ? "Storyboard saved" : "Saved, but the storyboard is not valid yet");
  }

  async function approve() {
    setError("");
    setStatus("Preparing preview");
    const response = await fetch(`/api/projects/${params.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftRevision: revision, planHash }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not render.");
      setStatus("");
      return;
    }
    setPreviewJobId(body.jobId);
    await waitForPreview(body.jobId, body.videoId);
  }

  async function waitForPreview(jobId: string, existingVideo?: string) {
    setPreviewPending(true);
    let video = existingVideo;
    for (let attempt = 0; !video && attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const jobResponse = await fetch(`/api/jobs/${jobId}`);
      const job = await jobResponse.json();
      if (!jobResponse.ok || job.state === "failed" || job.state === "cancelled") {
        setError(job.state === "cancelled" ? "Preview cancelled." : job?.error?.message || "Could not prepare the preview.");
        setStatus("");
        setPreviewPending(false);
        return;
      }
      video = job.result?.videoId;
    }
    if (!video) {
      setError("The preview is still queued. Check that the worker is running, then try again.");
      setStatus("");
      setPreviewPending(false);
      return;
    }
    setPreviewPending(false);
    setPreviewJobId("");
    setVideoId(video);
    await load();
    setStep("video");
    setStatus("Preview ready");
  }

  async function changePreviewJob(action: "cancel" | "retry") {
    const response = await fetch(`/api/jobs/${previewJobId}/${action}`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) { setError(body?.error?.message || "Could not update the preview job."); return; }
    if (action === "retry") {
      setError("");
      setStatus("Preparing preview");
      await waitForPreview(previewJobId);
    }
  }

  async function share() {
    const response = await fetch(`/api/videos/${videoId}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not share.");
      return;
    }
    setShareUrl(body.url);
  }

  async function ask() {
    const response = await fetch(`/api/projects/${params.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: copilot }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "The copilot could not answer.");
      return;
    }
    setCopilot("");
    const list = await fetch(`/api/projects/${params.id}/messages`);
    const notesBody = await list.json();
    setNotes(notesBody.items || []);
  }

  async function keep(id: string) {
    const response = await fetch(`/api/messages/${id}/keep`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not keep that.");
      return;
    }
    await load();
  }

  return (
    <main className="app studio">
      <header className="site-bar">
        <Brand href="/studio" />
        <nav className="site-nav">
          {(["idea", "storyboard", "video", "share"] as const).map((name) => (
            <button key={name} className={step === name ? "chip is-on" : "chip"} type="button" onClick={() => setStep(name)}>{name}</button>
          ))}
        </nav>
        <span className="fine">{status}</span>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <div className="studio-grid">
        <section>
          {step === "idea" ? (
            <div className="glass panel">
              <p className="kicker">{mode || "project"}</p>
              <form className="row-actions" onSubmit={renameProject}>
                <input className="field" value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} aria-label="Title" />
                <button className="btn ghost" type="submit" disabled={!title.trim()}>Rename</button>
              </form>
              <textarea className="field" value={idea.topic || ""} onChange={(event) => setIdea({ ...idea, topic: event.target.value })} placeholder="Topic" />
              <input className="field" value={idea.audience || ""} onChange={(event) => setIdea({ ...idea, audience: event.target.value })} placeholder="Audience" />
              <div className="row-actions">
                <button className="btn ghost" type="button" onClick={() => void saveIdea()}>Save</button>
                <button className="btn ghost" type="button" onClick={() => void brainstorm()}>Brainstorm</button>
                <button className="btn" type="button" onClick={() => void planStory()}>Plan storyboard</button>
              </div>
              {angles.length ? (
                <div className="cards">
                  {angles.map((angle) => (
                    <button key={angle.title} className="clay card" type="button" onClick={() => setIdea({ ...idea, topic: `${angle.title}. ${angle.hook} ${angle.takeaway}` })}>
                      <strong>{angle.title}</strong>
                      <span className="muted">{angle.hook}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <BriefPanel projectId={params.id} suggestedRequest={idea.topic || ""} audience={idea.audience} />
              {mode === "code_lab" ? (
                <div className="panel">
                  <p className="kicker">Code Lab</p>
                  <div className="row-actions">
                    <button className="chip" type="button" onClick={() => { setCode(SEARCH); setEntry("binary_search"); }}>Binary search</button>
                    <button className="chip" type="button" onClick={() => { setCode(FIB); setEntry("fib"); }}>fib(4)</button>
                  </div>
                  <textarea className="field" value={code} onChange={(event) => setCode(event.target.value)} style={{ minHeight: 220, fontFamily: "ui-monospace, monospace" }} />
                  <button className="btn" type="button" onClick={() => void trace()}>Trace</button>
                  {traceSummary ? <p>{traceSummary}</p> : null}
                  {traceError ? <p className="error">{traceError}</p> : null}
                </div>
              ) : null}
              {mode === "cartoon" ? <Puppet mouth={mouth} /> : null}
            </div>
          ) : null}
          {step === "storyboard" ? (
            <div className="panel">
              <label className="fine">Import a storyboard JSON file
                <input type="file" accept=".json,application/json" onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void importStoryboard(file);
                }} />
              </label>
              {plan?.scenes?.length ? plan.scenes.map((scene) => (
                <article key={scene.id} className="glass" style={{ padding: 14, marginBottom: 12 }}>
                  <p className="kicker">{scene.id} · {scene.purpose}</p>
                  <textarea className="field" value={scene.lines[0]?.text || ""} onChange={(event) => editLine(scene.id, event.target.value)} />
                  <p className="fine">{scene.layers.map((layer) => layer.component).join(" · ")}</p>
                </article>
              )) : <p className="muted">Plan a storyboard from the idea step.</p>}
              <div className="row-actions">
                <button className="btn ghost" type="button" onClick={() => void savePlan()} disabled={!plan}>Save edits</button>
                <button className="btn" type="button" onClick={() => void approve()} disabled={!planHash || previewPending}>Approve and preview</button>
                {previewJobId && previewPending ? <button className="btn" type="button" onClick={() => void changePreviewJob("cancel")}>Cancel preview</button> : null}
                {previewJobId && !previewPending ? <button className="btn" type="button" onClick={() => void changePreviewJob("retry")}>Retry preview</button> : null}
              </div>
            </div>
          ) : null}
          {step === "video" ? (
            <div className="panel">
              {warnings.map((warning) => <p key={warning} className="fine">{warning}</p>)}
              <iframe className="player" title="Preview" sandbox="allow-scripts" src={videoId ? `/api/videos/${videoId}/preview` : `/api/projects/${params.id}/preview`} />
            </div>
          ) : null}
          {step === "share" ? (
            <div className="glass panel">
              <p>Sharing will be available after a verified video export is ready.</p>
              <button className="btn" type="button" onClick={() => void share()} disabled>Copy a share link</button>
              {shareUrl ? <p><a href={shareUrl}>{shareUrl}</a></p> : null}
            </div>
          ) : null}
        </section>
        <aside className="glass dock">
          <p className="kicker">Copilot</p>
          <div className="notes">
            {notes.map((note) => (
              <div key={note.id}>
                <strong>{note.role}</strong>
                <p>{note.text}</p>
                {note.candidate?.status === "proposed" ? <button className="btn" type="button" onClick={() => void keep(note.id)}>Keep</button> : null}
              </div>
            ))}
          </div>
          <textarea className="field" value={copilot} onChange={(event) => setCopilot(event.target.value)} placeholder="Make it slower" />
          <button className="btn" type="button" onClick={() => void ask()}>Send</button>
          <Link className="fine" href="/studio/library">Library</Link>
        </aside>
      </div>
    </main>
  );
}

function Puppet({ mouth }: { mouth: number }) {
  const open = [8, 18, 6][mouth];
  return (
    <svg viewBox="0 0 200 220" width="180" aria-label="Original puppet">
      <ellipse cx="100" cy="200" rx="40" ry="8" fill="#000" opacity="0.25" />
      <path d="M100 20 L150 150 H50 Z" fill="#f3f3f3" />
      <ellipse cx="100" cy="150" rx="50" ry="16" fill="#8a8a8a" />
      <circle cx="82" cy="90" r="5" fill="#0D0A1F" />
      <circle cx="118" cy="90" r="5" fill="#0D0A1F" />
      <ellipse cx="100" cy="120" rx="10" ry={open} fill="#0D0A1F" />
    </svg>
  );
}
