"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, newKey, usePending, useJob, waitForJob, type JobView } from "../ui/client";
import { Button, MODE_LABEL, Notice, Panel, Progress, STAGE_LABEL } from "../ui/kit";
import { FilmPanel, SharePanel, type VideoItem } from "./film-panel";
import { MontagePanel } from "./montage-panel";
import { BriefPanel, CastPanel, CodePanel, LyricsPanel, ReelPanel, SettingsPanel, type Catalog, type ProjectView } from "./panels";
import { StoryboardPanel, type Plan } from "./storyboard";
import { StudioBar } from "./studio-bar";

type Idea = { topic?: string; audience?: string; notes?: string };
type Note = { id: string; role: string; text: string; candidate?: { summary?: string; status?: string; changeClass?: string } };
type Angle = { title: string; hook: string; takeaway: string };
type Step = "idea" | "storyboard" | "film" | "share";
type Issue = { path: string; message: string };

const FILM_MODES = ["explainer", "code_lab", "audio", "story", "cartoon", "lyrics"];

export function Workspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { run, busy } = usePending();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [series, setSeries] = useState<{ id: string; title: string } | null>(null);
  const [step, setStep] = useState<Step>("idea");
  const [idea, setIdea] = useState<Idea>({});
  const [revision, setRevision] = useState(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planHash, setPlanHash] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [hasTrace, setHasTrace] = useState(false);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [copilot, setCopilot] = useState("");
  const [focus, setFocus] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const savedPlan = useRef("");
  const savedIdea = useRef("");

  const loadVideos = useCallback(async () => {
    const res = await api<{ items: VideoItem[] }>(`/api/projects/${params.id}/videos`);
    if (res.ok) setVideos(res.data.items);
    return res.ok ? res.data.items : [];
  }, [params.id]);

  const loadNotes = useCallback(async () => {
    const res = await api<{ items: Note[] }>(`/api/projects/${params.id}/messages`);
    if (res.ok) setNotes(res.data.items);
  }, [params.id]);

  const load = useCallback(async () => {
    const res = await api<{ project: ProjectView; draft: { revision: number; idea: Idea; plan: Plan | null; planHash?: string; planValid: boolean; issues?: Issue[]; traceId?: string } | null; video: VideoItem | null; activeJob: { id: string } | null }>(`/api/projects/${params.id}`);
    if (!res.ok) { setError(res.status === 404 ? "That project is not here. It may have been deleted." : res.error); return null; }
    const d = res.data.draft;
    setProject(res.data.project);
    setTitle(res.data.project.title);
    setIdea(d?.idea ?? {});
    savedIdea.current = JSON.stringify(d?.idea ?? {});
    setRevision(d?.revision ?? 1);
    setPlan(d?.plan ?? null);
    savedPlan.current = JSON.stringify(d?.plan ?? null);
    setPlanHash(d?.planValid ? d.planHash ?? "" : "");
    setIssues(d?.planValid ? [] : d?.issues ?? []);
    setHasTrace(Boolean(d?.traceId));
    if (res.data.video?.id) setSelectedVideo((current) => current || res.data.video!.id);
    return res.data;
  }, [params.id]);

  const { job, follow, clear, active: jobActive } = useJob(async (finished: JobView) => {
    await afterJob(finished);
  });

  async function afterJob(finished: JobView) {
    if (finished.state === "failed") setError(finished.error?.message ?? "That did not finish.");
    if (finished.state === "cancelled") setStatus("Cancelled");
    if (finished.state !== "succeeded") { await load(); return; }
    if (finished.type === "plan") { await load(); setStep("storyboard"); setStatus(String(finished.result?.notice ?? "Storyboard ready")); clear(); return; }
    if (finished.type === "revise" || finished.type === "scene_regen") { await loadNotes(); setStatus("The copilot has a proposal"); clear(); return; }
    if (finished.type === "render" || finished.type === "caption") {
      const list = await loadVideos();
      await load();
      const made = finished.result?.videoId ? String(finished.result.videoId) : list[0]?.id;
      if (made) setSelectedVideo(made);
      setStep("film");
      setStatus(finished.result?.qaPassed === false ? "Finished, but it did not pass QA" : finished.type === "render" && !finished.result?.qaPassed && finished.stages.some((s) => s.name === "preview") ? "Preview ready" : "Film ready");
      clear();
    }
  }

  useEffect(() => {
    void (async () => {
      const data = await load();
      await loadVideos();
      await loadNotes();
      const cat = await api<Catalog>("/api/catalog");
      if (cat.ok) setCatalog(cat.data);
      if (data?.project.seriesId) {
        const s = await api<{ series: { id: string; title: string } }>(`/api/series/${data.project.seriesId}`);
        if (s.ok) setSeries({ id: s.data.series.id, title: s.data.series.title });
      }
      if (data?.activeJob?.id) void follow(data.activeJob.id);
      if (data?.draft?.plan && FILM_MODES.includes(data.project.mode)) setStep("storyboard");
      if (["montage", "reel"].includes(data?.project.mode ?? "") && data?.video) setStep("film");
    })();
  }, [load, loadVideos, loadNotes, follow]);

  const saveIdea = async () => {
    const res = await api<{ revision: number }>(`/api/projects/${params.id}/draft`, { method: "PATCH", body: { expectedRevision: revision, idea: { topic: idea.topic ?? "", audience: idea.audience ?? "", notes: idea.notes ?? "" } } });
    if (!res.ok) { setError(res.reason === "REVISION_CONFLICT" ? "This project changed in another tab. Reload to continue." : res.error); return false; }
    setRevision(res.data.revision);
    savedIdea.current = JSON.stringify(idea);
    return true;
  };

  const rename = (event: React.FormEvent) => {
    event.preventDefault();
    void run("rename", async () => {
      const res = await api<{ project: ProjectView }>(`/api/projects/${params.id}`, { method: "PATCH", body: { title } });
      if (!res.ok) { setError(res.error); return; }
      setProject(res.data.project);
      setStatus("Renamed");
    });
  };

  const brainstorm = () => run("brainstorm", async () => {
    setError("");
    if (!(await saveIdea())) return;
    const res = await api<{ jobId: string }>(`/api/projects/${params.id}/brainstorm`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setStatus("Thinking of angles");
    const done = await waitForJob(res.data.jobId);
    if (done?.state !== "succeeded") { setError(done?.error?.message ?? "Brainstorm did not finish."); setStatus(""); return; }
    setAngles((done.result?.angles as Angle[]) ?? []);
    setStatus("Pick an angle, or keep your own");
  });

  const planIt = () => run("plan", async () => {
    setError("");
    if (plan && JSON.stringify(plan) !== savedPlan.current && !confirm("You have unsaved storyboard edits. Planning again replaces the storyboard. Continue?")) return;
    if (!(await saveIdea())) return;
    const res = await api<{ jobId: string }>(`/api/projects/${params.id}/plan`, { body: {} });
    if (!res.ok) { setError(res.error); if (res.details?.activeJobId) void follow(String(res.details.activeJobId)); return; }
    setStatus("Planning the storyboard");
    void follow(res.data.jobId);
  });

  const approve = async (output: "mp4" | "preview") => {
    setError("");
    const res = await api<{ jobId: string }>(`/api/projects/${params.id}/approve`, { body: { draftRevision: revision, planHash, output }, idempotencyKey: newKey() });
    if (!res.ok) { setError(res.error); if (res.details?.activeJobId) void follow(String(res.details.activeJobId)); return; }
    setStatus(output === "mp4" ? "Rendering the film" : "Preparing preview");
    void follow(res.data.jobId);
  };

  const changeJob = (action: "cancel" | "retry") => run(`job-${action}`, async () => {
    if (!job) return;
    const res = await api(`/api/jobs/${job.id}/${action}`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setError("");
    if (action === "retry") void follow(job.id);
    else { setStatus("Cancelled"); await load(); void follow(job.id); }
  });

  const ask = () => run("ask", async () => {
    setError("");
    if (plan && JSON.stringify(plan) !== savedPlan.current) { setError("Save your storyboard edits first, so the copilot works from them."); return; }
    const res = await api<{ jobId: string }>(`/api/projects/${params.id}/messages`, { body: { text: copilot, sceneIds: focus } });
    if (!res.ok) { setError(res.error); return; }
    setCopilot("");
    await loadNotes();
    void follow(res.data.jobId);
  });

  const decide = (id: string, action: "keep" | "discard") => run(`decide-${id}`, async () => {
    if (action === "keep" && plan && JSON.stringify(plan) !== savedPlan.current && !confirm("Keeping this replaces your unsaved storyboard edits. Continue?")) return;
    const res = await api(`/api/messages/${id}/${action}`, { body: action === "keep" ? { expectedRevision: revision } : {} });
    if (!res.ok) { setError(res.reason === "STALE_CANDIDATE" || res.status === 409 ? "The storyboard changed since this proposal. Ask again." : res.error); return; }
    await load();
    await loadNotes();
    setStatus(action === "keep" ? "Change kept" : "Change discarded");
  });

  if (!project) {
    return (
      <main className="app studio">
        <StudioBar status={status} />
        {error ? <Notice tone="bad">{error} <Link href="/studio">Back to projects</Link></Notice> : <div className="surface panel skeleton tall" aria-busy="true" />}
      </main>
    );
  }

  const mode = project.mode;
  const filmMode = FILM_MODES.includes(mode);
  const planned = filmMode && mode !== "lyrics";
  const steps: { id: Step; label: string }[] = filmMode
    ? [{ id: "idea", label: mode === "lyrics" ? "Song" : "Idea" }, { id: "storyboard", label: "Storyboard" }, { id: "film", label: "Film" }, { id: "share", label: "Share" }]
    : [{ id: "idea", label: mode === "reel" ? "Reel" : "Make" }, { id: "film", label: "Film" }, { id: "share", label: "Share" }];
  const voice = catalog?.voices.find((v) => v.id === project.voiceId);
  const selected = videos.find((v) => v.id === selectedVideo) ?? videos[0];
  const busyJob = Boolean(job && ["queued", "running", "waiting_quota"].includes(job.state));

  return (
    <main className="app studio" data-mode={mode}>
      <StudioBar status={status} />
      <div className="ws-band">
        <div className="ws-head">
          <form className="ws-title" onSubmit={rename}>
            <span className="sticker">{MODE_LABEL[mode] ?? mode}</span>
            <input className="field" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            {title !== project.title ? <Button tone="ghost" size="sm" type="submit" pending={busy("rename")}>Rename</Button> : null}
            <span className="badge" data-tone={project.badge}>{project.badge}</span>
          </form>
          <nav className="steps-nav" aria-label="Project steps">
            {steps.map((item, index) => (
              <button key={item.id} className={step === item.id ? "is-on" : ""} type="button" aria-current={step === item.id ? "step" : undefined} onClick={() => setStep(item.id)}>
                <span className="n" aria-hidden="true">{index + 1}</span>{item.label}
              </button>
            ))}
          </nav>
        </div>
        {series ? <p className="fine">Episode {project.episodeNumber} of <Link href={`/studio/series/${series.id}`}>{series.title}</Link>{project.seriesVersion ? ` · series version ${project.seriesVersion}` : ""}</p> : null}
      </div>

      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      {job ? (
        <section className="surface panel job-box" aria-label="Current job">
          <Progress stages={job.stages} labels={STAGE_LABEL} state={job.state} />
          {job.state === "failed" && job.error?.message ? <p className="error">{job.error.message}</p> : null}
          <div className="row-actions">
            {busyJob ? <Button tone="ghost" size="sm" pending={busy("job-cancel")} onClick={() => void changeJob("cancel")}>Cancel</Button> : null}
            {job.state === "failed" || job.state === "cancelled" ? <Button tone="ghost" size="sm" pending={busy("job-retry")} onClick={() => void changeJob("retry")}>Try again</Button> : null}
            {!busyJob ? <Button tone="quiet" size="sm" onClick={clear}>Dismiss</Button> : null}
          </div>
        </section>
      ) : null}

      <div className={planned ? "studio-grid" : "studio-grid single"}>
        <section className="ws-main">
          {step === "idea" ? (
            <>
              {planned ? (
                <Panel kicker={MODE_LABEL[mode]} title={mode === "code_lab" ? "What should the film teach?" : mode === "audio" ? "What will be said?" : "What is this film about?"}>
                  <label className="stack-label">Topic
                    <textarea className="field" value={idea.topic ?? ""} onChange={(e) => setIdea({ ...idea, topic: e.target.value })} placeholder="One or two sentences" maxLength={2000} />
                  </label>
                  <div className="split">
                    <label className="stack-label">Who is it for
                      <input className="field" value={idea.audience ?? ""} onChange={(e) => setIdea({ ...idea, audience: e.target.value })} placeholder="Audience" maxLength={200} />
                    </label>
                    <label className="stack-label">Notes for the planner (optional)
                      <input className="field" value={idea.notes ?? ""} onChange={(e) => setIdea({ ...idea, notes: e.target.value })} placeholder="Use a chai example; end with a question" maxLength={2000} />
                    </label>
                  </div>
                  <div className="row-actions">
                    <Button tone="ghost" pending={busy("save-idea")} disabled={JSON.stringify(idea) === savedIdea.current} onClick={() => void run("save-idea", async () => { if (await saveIdea()) setStatus("Saved"); })}>Save</Button>
                    <Button tone="ghost" pending={busy("brainstorm")} disabled={busyJob} onClick={() => void brainstorm()}>Brainstorm angles</Button>
                    <Button tone="accent" pending={busy("plan")} disabled={busyJob || !idea.topic?.trim() || (mode === "code_lab" && !hasTrace)} onClick={() => void planIt()}>Plan storyboard</Button>
                  </div>
                  {mode === "code_lab" && !hasTrace ? <p className="fine">Trace your code below first; the film is built from what really ran.</p> : null}
                  {angles.length ? (
                    <div className="cards" aria-label="Angles">
                      {angles.map((angle) => (
                        <button key={angle.title} className="surface card angle" type="button" onClick={() => setIdea({ ...idea, topic: `${angle.title}. ${angle.hook} ${angle.takeaway}`.slice(0, 2000) })}>
                          <strong>{angle.title}</strong><span className="muted">{angle.hook}</span><span className="fine">{angle.takeaway}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </Panel>
              ) : null}
              {mode === "code_lab" ? <CodePanel projectId={project.id} onTraced={(rev) => { setHasTrace(true); if (rev) setRevision(rev); }} /> : null}
              {mode === "story" || mode === "cartoon" ? <CastPanel project={project} onChange={(castIds) => setProject({ ...project, castIds })} /> : null}
              {mode === "lyrics" ? <LyricsPanel project={project} revision={revision} onBuilt={async () => { await load(); setStep("storyboard"); }} /> : null}
              {mode === "montage" ? <MontagePanel project={project} catalog={catalog} disabled={busyJob} onQueued={(id) => { setStatus("Rendering the montage"); void follow(id); }} /> : null}
              {mode === "reel" ? <ReelPanel project={project} catalog={catalog} disabled={busyJob} onQueued={(id) => { setStatus("Captioning your reel"); void follow(id); }} /> : null}
              {planned ? <BriefPanel scope="projects" id={project.id} suggested={idea.topic ?? ""} audience={idea.audience} researchAvailable={Boolean(catalog?.research.available)} onApproved={() => setStatus("Brief approved")} /> : null}
              <SettingsPanel project={project} catalog={catalog} planLanguage={plan?.language} onError={setError} onSaved={(p, draftRevision) => { setProject(p); setStatus("Saved"); if (draftRevision) void load(); }} />
              <DangerZone project={project} onDeleted={() => router.push("/studio")} onError={setError} />
            </>
          ) : null}

          {step === "storyboard" && filmMode ? (
            <StoryboardPanel
              project={project} plan={plan} revision={revision} planHash={planHash} issues={issues} voice={voice} jobActive={jobActive}
              onPlan={(p) => { setPlan(p); setPlanHash(""); }}
              onSaved={(rev, hash, iss) => { setRevision(rev); setPlanHash(hash); setIssues(iss); savedPlan.current = JSON.stringify(plan); }}
              onApprove={approve} onFocus={setFocus} focus={focus}
              onRegenerated={async () => { await load(); await loadNotes(); }}
              onError={setError} onStatus={setStatus}
            />
          ) : null}

          {step === "film" ? <FilmPanel videos={videos} selectedId={selected?.id ?? ""} format={project.format} onSelect={setSelectedVideo} onChanged={async () => { await loadVideos(); await load(); }} /> : null}
          {step === "share" ? <SharePanel key={selected?.id ?? "none"} video={selected} /> : null}
        </section>

        {planned ? (
          <aside className="surface dock" aria-label="Copilot">
            <div>
              <p className="kicker">Copilot</p>
              <h3>Ask for a change</h3>
            </div>
            <div className="notes">
              {notes.length === 0 ? <p className="fine">Try “Make it slower” or “Make the ending punchier”. Changes arrive as a proposal you keep or discard.</p> : null}
              {notes.map((note) => (
                <div key={note.id} className={`note ${note.role}`}>
                  <strong>{note.role === "user" ? "You" : "Copilot"}</strong>
                  <p>{note.text}</p>
                  {note.candidate?.status === "proposed" ? (
                    <div className="row-actions">
                      <Button size="sm" pending={busy(`decide-${note.id}`)} onClick={() => void decide(note.id, "keep")}>Keep</Button>
                      <Button tone="ghost" size="sm" pending={busy(`decide-${note.id}`)} onClick={() => void decide(note.id, "discard")}>Discard</Button>
                    </div>
                  ) : note.candidate?.status ? <p className="fine">{note.candidate.status}</p> : null}
                </div>
              ))}
            </div>
            <p className="fine">{focus.length ? `Only ${focus.join(", ")} will change.` : "Tick scenes in the storyboard to limit a change to them."}</p>
            <textarea className="field" aria-label="Message to the copilot" value={copilot} maxLength={4000} onChange={(e) => setCopilot(e.target.value)} placeholder="Make it slower" />
            <Button pending={busy("ask")} disabled={!copilot.trim() || !plan || busyJob} onClick={() => void ask()}>Send</Button>
            {!plan ? <p className="fine">Plan a storyboard first.</p> : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function DangerZone({ project, onDeleted, onError }: { project: ProjectView; onDeleted: () => void; onError: (m: string) => void }) {
  const { run, busy } = usePending();
  const router = useRouter();
  return (
    <Panel kicker="Project" title="Copy or delete">
      <div className="row-actions">
        <Button tone="ghost" pending={busy("dup")} onClick={() => void run("dup", async () => {
          const res = await api<{ project: { id: string } }>(`/api/projects/${project.id}/duplicate`, { body: {} });
          if (!res.ok) { onError(res.error); return; }
          router.push(`/studio/p/${res.data.project.id}`);
        })}>Duplicate project</Button>
        <Button tone="danger" pending={busy("del")} onClick={() => void run("del", async () => {
          if (!confirm(`Delete “${project.title}”? Share links stop working now. You can restore it for 7 days.`)) return;
          const res = await api(`/api/projects/${project.id}`, { method: "DELETE" });
          if (!res.ok) { onError(res.error); return; }
          onDeleted();
        })}>Delete project</Button>
      </div>
    </Panel>
  );
}
