"use client";

import { useEffect, useState } from "react";
import { validatePlan } from "../../contracts/plan";
import { api, newKey, usePending, waitForJob } from "../ui/client";
import { Button, Notice, Panel, timeAgo } from "../ui/kit";
import type { ProjectView, Voice } from "./panels";

type Layer = { id: string; component: string; props: Record<string, unknown>; slot: string };
type Line = { id: string; text: string; spoken?: string };
type Scene = { id: string; purpose: string; lines: Line[]; layers: Layer[]; holdMs?: number };
export type Plan = { title?: string; scenes: Scene[]; language?: string; format?: string; mode?: string; cast?: { name: string }[] };

const SETS = ["home", "room", "bank", "lane", "street", "park", "school", "office", "market", "night"];
const ACTIONS = ["talk", "walk", "wave", "point", "turn", "hold", "sit", "jump"];
const SHOTS = ["wide", "medium", "close"];

export function StoryboardPanel({ project, plan, revision, planHash, issues, voice, jobActive, onPlan, onSaved, onApprove, onFocus, focus, onRegenerated, onError, onStatus }: {
  project: ProjectView; plan: Plan | null; revision: number; planHash: string; issues: { path: string; message: string }[]; voice: Voice | undefined; jobActive: boolean;
  onPlan: (plan: Plan) => void; onSaved: (revision: number, planHash: string, issues: { path: string; message: string }[]) => void;
  onApprove: (output: "mp4" | "preview") => Promise<void>; onFocus: (ids: string[]) => void; focus: string[]; onRegenerated: () => Promise<void>; onError: (m: string) => void; onStatus: (m: string) => void;
}) {
  const { run, busy } = usePending();
  // Edits belong to the revision they were made on; a new revision (save, keep, restore) clears them.
  const [dirtyAt, setDirtyAt] = useState<number | null>(null);
  const dirty = dirtyAt === revision;
  const setDirty = (value: boolean) => setDirtyAt(value ? revision : null);
  const [versions, setVersions] = useState<{ version: number; title: string; scenes: number; approvedAt: string; origin: string }[] | null>(null);
  const [stillsNote, setStillsNote] = useState("");


  const edit = (next: Plan) => { onPlan(next); setDirty(true); };
  const editLine = (sceneId: string, lineId: string, text: string) => plan && edit({ ...plan, scenes: plan.scenes.map((s) => (s.id === sceneId ? { ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, text } : l)) } : s)) });
  const editLayer = (sceneId: string, layerId: string, props: Record<string, unknown>) => plan && edit({ ...plan, scenes: plan.scenes.map((s) => (s.id === sceneId ? { ...s, layers: s.layers.map((l) => (l.id === layerId ? { ...l, props: { ...l.props, ...props } } : l)) } : s)) });

  const save = () => run("save", async () => {
    const res = await api<{ revision: number; planValid: boolean; planHash?: string; issues?: { path: string; message: string }[] }>(`/api/projects/${project.id}/draft`, { method: "PATCH", body: { expectedRevision: revision, plan } });
    if (!res.ok) { onError(res.reason === "REVISION_CONFLICT" ? "The storyboard changed somewhere else. Reload to see the latest, then make your edit again." : res.error); return; }
    onSaved(res.data.revision, res.data.planValid ? res.data.planHash ?? "" : "", res.data.planValid ? [] : res.data.issues ?? []);
    setDirty(false);
    onStatus(res.data.planValid ? "Storyboard saved" : "Saved, but the storyboard is not valid yet");
  });

  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1024 * 1024) { onError("Choose a storyboard JSON file smaller than 1 MB."); return; }
    try {
      const checked = validatePlan(JSON.parse(await file.text()));
      if (!checked.plan) { onError(checked.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join(". ")); return; }
      edit(checked.plan as Plan);
      onStatus("Storyboard imported. Save it to approve.");
    } catch { onError("Could not read that storyboard JSON file."); }
  };

  const exportFile = () => {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(plan.title ?? "storyboard").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const regenerate = (sceneId: string) => run(`regen-${sceneId}`, async () => {
    if (dirty) { onError("Save your edits first, so the rewrite starts from them."); return; }
    const res = await api<{ jobId: string }>(`/api/projects/${project.id}/scenes/${sceneId}/regenerate`, { body: {} });
    if (!res.ok) { onError(res.error); return; }
    onStatus(`Rewriting ${sceneId}. The proposal will appear in the copilot.`);
    await waitForJob(res.data.jobId);
    await onRegenerated();
  });

  const drawStills = (redraw: boolean) => run("stills", async () => {
    if (dirty) { onError("Save your edits first."); return; }
    const res = await api<{ jobId: string }>(`/api/projects/${project.id}/stills`, { body: { redraw } });
    if (!res.ok) { onError(res.error); return; }
    setStillsNote("Drawing stills...");
    const job = await waitForJob(res.data.jobId, (j) => { const s = j.stages[0]; if (s?.total) setStillsNote(`Drawing stills: ${s.done ?? 0} of ${s.total}`); });
    setStillsNote(job?.state === "succeeded" ? "Stills drawn." : job?.error?.message ?? "Drawing stopped.");
    await onRegenerated();
  });

  const loadVersions = () => run("versions", async () => {
    const res = await api<{ items: { version: number; title: string; scenes: number; approvedAt: string; origin: string }[] }>(`/api/projects/${project.id}/storyboards`);
    setVersions(res.ok ? res.data.items : []);
  });

  const restore = (version: number) => run(`restore-${version}`, async () => {
    if (dirty && !confirm("You have unsaved edits. Restoring replaces them. Continue?")) return;
    const res = await api(`/api/projects/${project.id}/storyboards/${version}/restore`, { body: { expectedRevision: revision } });
    if (!res.ok) { onError(res.error); return; }
    onStatus(`Storyboard version ${version} restored as your draft.`);
    await onRegenerated();
  });

  const stillsNeeded = plan?.scenes.some((s) => s.layers.some((l) => l.component === "image.still@1" && !l.props.assetId));
  const anyStills = plan?.scenes.some((s) => s.layers.some((l) => l.component === "image.still@1"));
  const narrated = project.mode !== "lyrics";

  return (
    <>
      <Panel kicker={`Revision ${revision}${dirty ? " · unsaved" : ""}`} title={plan?.title || "Storyboard"} actions={
        <>
          <label className="btn ghost sm upload-btn">Import JSON<input type="file" accept=".json,application/json" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void importFile(f); }} /></label>
          <Button tone="ghost" size="sm" disabled={!plan} onClick={exportFile}>Export JSON</Button>
        </>
      }>
        {issues.length ? <Notice tone="bad">{issues.slice(0, 5).map((i) => <div key={i.path + i.message}>{i.path}: {i.message}</div>)}</Notice> : null}
        {anyStills ? (
          <div className="row-actions">
            <Button tone={stillsNeeded ? "accent" : "ghost"} size="sm" pending={busy("stills")} onClick={() => void drawStills(false)}>{stillsNeeded ? "Draw the stills" : "Draw missing stills"}</Button>
            <Button tone="quiet" size="sm" pending={busy("stills")} onClick={() => void drawStills(true)}>Redraw all</Button>
            {stillsNote ? <span className="fine" role="status">{stillsNote}</span> : null}
          </div>
        ) : null}
        {plan?.scenes?.length ? plan.scenes.map((scene) => {
          const stage = scene.layers.find((l) => l.component === "stage.perform@1");
          const still = scene.layers.find((l) => l.component === "image.still@1");
          return (
            <article key={scene.id} className="raised scene">
              <div className="scene-head">
                <label className="row-actions">
                  <input type="checkbox" aria-label={`Limit copilot changes to ${scene.id}`} checked={focus.includes(scene.id)} onChange={(e) => onFocus(e.target.checked ? [...focus, scene.id] : focus.filter((id) => id !== scene.id))} />
                  <strong>{scene.id.toUpperCase()} · {scene.purpose}</strong>
                </label>
                {narrated ? <Button tone="quiet" size="sm" pending={busy(`regen-${scene.id}`)} onClick={() => void regenerate(scene.id)}>Rewrite scene</Button> : null}
              </div>
              <div className={still ? "scene-body" : ""}>
                {still ? (
                  typeof still.props.assetId === "string" ? <img className="still-thumb" src={`/api/assets/${still.props.assetId}/file`} alt={String(still.props.prompt ?? "")} /> : <div className="still-thumb">Not drawn yet</div>
                ) : null}
                <div className="scene-fields">
                  {scene.lines.map((line) => (
                    <textarea key={line.id} className="field" aria-label={`Narration for ${scene.id} ${line.id}`} value={line.text} onChange={(e) => editLine(scene.id, line.id, e.target.value)} readOnly={project.mode === "lyrics"} />
                  ))}
                  {still ? <textarea className="field small" aria-label={`Picture for ${scene.id}`} value={String(still.props.prompt ?? "")} onChange={(e) => editLayer(scene.id, still.id, { prompt: e.target.value, assetId: undefined })} /> : null}
                  {stage ? (
                    <div className="stage-controls">
                      <select className="field field-sm" aria-label={`Set for ${scene.id}`} value={String(stage.props.set ?? "bank")} onChange={(e) => editLayer(scene.id, stage.id, { set: e.target.value })}>{SETS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                      <select className="field field-sm" aria-label={`Action for ${scene.id}`} value={String(stage.props.action ?? "talk")} onChange={(e) => editLayer(scene.id, stage.id, { action: e.target.value })}>{ACTIONS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                      <select className="field field-sm" aria-label={`Shot for ${scene.id}`} value={String(stage.props.shot ?? "medium")} onChange={(e) => editLayer(scene.id, stage.id, { shot: e.target.value })}>{SHOTS.map((v) => <option key={v} value={v}>{v} shot</option>)}</select>
                      {plan.cast?.length ? (
                        <select className="field field-sm" aria-label={`Speaker for ${scene.id}`} value={String(stage.props.speaker ?? -1)} onChange={(e) => editLayer(scene.id, stage.id, { speaker: Number(e.target.value) })}>
                          <option value={-1}>Narrator speaks</option>
                          {plan.cast.map((c, i) => <option key={c.name} value={i}>{c.name} speaks</option>)}
                        </select>
                      ) : null}
                    </div>
                  ) : (
                    <span className="fine mono">{scene.layers.map((l) => l.component.replace(/@\d+$/, "")).join(", ")}</span>
                  )}
                </div>
              </div>
            </article>
          );
        }) : <p className="empty">Plan a storyboard from the first step, or import an authored JSON file.</p>}
        <div className="row-actions">
          <Button tone={dirty ? "accent" : "ghost"} pending={busy("save")} disabled={!plan} onClick={() => void save()}>Save edits</Button>
          <Button tone="quiet" size="sm" pending={busy("versions")} onClick={() => (versions ? setVersions(null) : void loadVersions())}>{versions ? "Hide approved versions" : "Approved versions"}</Button>
        </div>
        {versions ? (
          versions.length ? <div className="versions">{versions.map((v) => (
            <div key={v.version} className="version"><span>v{v.version} · {v.title} · {v.scenes} scenes · {timeAgo(v.approvedAt)}</span><Button tone="ghost" size="sm" pending={busy(`restore-${v.version}`)} onClick={() => void restore(v.version)}>Restore</Button></div>
          ))}</div> : <p className="fine">No approved storyboards yet.</p>
        ) : null}
      </Panel>

      <Panel kicker="Approve" title="Make the film">
        {voice && narrated ? <p className="fine">Narrator: {voice.label}. {voice.timing === "aligned" ? "Captions follow measured word times." : "Caption times are estimated."} {voice.commercial ? "" : "Non-commercial voice."}</p> : null}
        {project.executionTarget === "paired-agent" ? <p className="fine">This film renders on your paired PC{project.renderProfile === "cinematic-3d" ? " with Blender" : ""}.</p> : null}
        <div className="row-actions">
          <Button tone="accent" size="lg" pending={busy("approve-mp4")} disabled={!planHash || dirty || jobActive || (narrated && !voice?.available) || Boolean(stillsNeeded)} onClick={() => void run("approve-mp4", () => onApprove("mp4"))}>Approve and render film</Button>
          <Button tone="ghost" pending={busy("approve-preview")} disabled={!planHash || dirty || jobActive} onClick={() => void run("approve-preview", () => onApprove("preview"))}>Silent preview</Button>
        </div>
        {dirty ? <p className="fine">Save your edits to approve them.</p> : !planHash && plan ? <p className="fine">Save a valid storyboard to approve it.</p> : stillsNeeded ? <p className="fine">Draw every still first.</p> : narrated && voice && !voice.available ? <p className="fine">The narrator is not set up: {voice.reason}</p> : null}
      </Panel>
    </>
  );
}

export const approveKey = newKey;
