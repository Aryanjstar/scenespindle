"use client";

import { useEffect, useState } from "react";
import { api, usePending, waitForJob } from "../ui/client";
import { Button, CopyRow, Empty, Notice, Panel, timeAgo } from "../ui/kit";

export type VideoItem = {
  id: string;
  version: number;
  kind: "mp4" | "preview";
  state: string;
  current: boolean;
  durationMs: number;
  warnings: string[];
  timing?: string;
  voiceId?: string;
  commercialSafe?: boolean;
  qa?: { passed: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  createdAt?: string;
  files?: { mp4: string; thumb: string; sheet: string; srt?: string; vtt?: string };
  previewUrl?: string;
};

const EXPORTS = [
  { kind: "mp4", label: "MP4" }, { kind: "srt", label: "SRT captions" }, { kind: "vtt", label: "VTT captions" },
  { kind: "audio", label: "Audio only" }, { kind: "package", label: "Project package (zip)" }, { kind: "otio", label: "Editor timeline (OTIO)" },
] as const;

export function FilmPanel({ videos, selectedId, format, onSelect, onChanged }: { videos: VideoItem[]; selectedId: string; format: string; onSelect: (id: string) => void; onChanged: () => Promise<void> }) {
  const { run, busy } = usePending();
  const video = videos.find((item) => item.id === selectedId) ?? videos[0];
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  if (!video) return <Empty title="No film yet"><p className="fine">Approve the storyboard (or render your montage or reel) to make one.</p></Empty>;
  const shape = format === "16x9" ? "landscape" : format === "1x1" ? "square" : "";

  const makeCurrent = () => run("current", async () => {
    const res = await api(`/api/videos/${video.id}/make-current`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setNote(`Version ${video.version} is now the current film.`);
    await onChanged();
  });

  const exportAs = (kind: string) => run(`export-${kind}`, async () => {
    setError("");
    const res = await api<{ url?: string; jobId?: string }>(`/api/videos/${video.id}/exports`, { body: { kind } });
    if (!res.ok) { setError(res.error); return; }
    let url = res.data.url;
    if (!url && res.data.jobId) {
      setNote("Preparing the file...");
      const job = await waitForJob(res.data.jobId);
      if (job?.state !== "succeeded") { setError(job?.error?.message ?? "The export did not finish."); setNote(""); return; }
      url = String(job.result?.url ?? "");
      setNote("Ready.");
    }
    if (url) window.location.assign(url.includes("?") ? url : `${url}`);
  });

  return (
    <Panel className="film-panel">
      <div className="film">
        {video.kind === "mp4" && video.files ? (
          <video key={video.id} className={shape} controls playsInline preload="metadata" poster={video.files.thumb} aria-label={`Film version ${video.version}`}>
            <source src={video.files.mp4} type="video/mp4" />
            {video.files.vtt ? <track kind="captions" src={video.files.vtt} srcLang="en" label="Captions" /> : null}
          </video>
        ) : (
          <iframe className={`player ${shape}`} title="Preview" sandbox="allow-scripts" src={video.previewUrl} />
        )}
        <div className="film-side">
          <div>
            <p className="kicker">Version {video.version}{video.current ? " · current" : ""} · {timeAgo(video.createdAt)}</p>
            <h2>{video.kind === "mp4" ? (video.state === "ready" ? "Film ready" : "Did not pass QA") : "Silent preview"}</h2>
          </div>
          {video.kind === "preview" ? <Notice>This is a silent HTML preview with estimated timing. Render the film for narration, captions and an MP4.</Notice> : null}
          {video.warnings.map((warning) => <Notice key={warning} tone="warn">{warning}</Notice>)}
          <dl className="meta">
            <dt>Length</dt><dd className="mono">{(video.durationMs / 1000).toFixed(1)} s</dd>
            {video.voiceId ? <><dt>Narrator</dt><dd>{video.voiceId}</dd></> : null}
            {video.timing ? <><dt>Caption timing</dt><dd>{video.timing === "aligned" ? "Measured" : "Estimated"}</dd></> : null}
          </dl>
          {video.kind === "mp4" && video.state === "ready" ? (
            <div className="stack-label">
              <span className="stack-label-text">Download</span>
              <div className="row-actions">
                {EXPORTS.filter((e) => e.kind !== "srt" || video.files?.srt).filter((e) => e.kind !== "vtt" || video.files?.vtt).map((e) => (
                  <Button key={e.kind} tone={e.kind === "mp4" ? "solid" : "ghost"} size="sm" pending={busy(`export-${e.kind}`)} onClick={() => void exportAs(e.kind)}>{e.label}</Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="row-actions">
            {video.files ? <Button tone="ghost" size="sm" onClick={() => setSheet((v) => !v)}>{sheet ? "Hide frames" : "Frame sheet"}</Button> : null}
            {video.kind === "mp4" && video.state === "ready" && !video.current ? <Button tone="ghost" size="sm" pending={busy("current")} onClick={() => void makeCurrent()}>Make current</Button> : null}
          </div>
          {video.qa ? (
            <div>
              <p className="kicker">Automatic checks · {video.qa.passed ? "passed" : "failed"}</p>
              <div className="qa">
                {video.qa.checks.map((check) => (
                  <div key={check.name}><span className={check.ok ? "" : "error"}>{check.ok ? "✓" : "✕"} {check.name}</span><span className="mono">{check.detail}</span></div>
                ))}
              </div>
              <p className="fine">Checks cover streams, size, length and loudness. Watch the film and look at the frame sheet before you share it.</p>
            </div>
          ) : null}
          {sheet && video.files ? <img className="sheet" src={video.files.sheet} alt={`Eight frames sampled across version ${video.version}`} /> : null}
          <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
          <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
        </div>
      </div>
      {videos.length > 1 ? (
        <div>
          <p className="kicker">All versions</p>
          <div className="versions">
            {videos.map((item) => (
              <button key={item.id} type="button" className={item.id === video.id ? "version is-on" : "version"} onClick={() => { setSheet(false); onSelect(item.id); }}>
                <span>v{item.version} · {item.kind === "mp4" ? "Film" : "Preview"}{item.current ? " · current" : ""} · {timeAgo(item.createdAt)}</span>
                <span className="badge" data-tone={item.state === "ready" ? "ready" : item.state === "failed" ? "failed" : "review"}>{item.state}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

type Share = { url: string; allowDownload: boolean; views: number };

export function SharePanel({ video }: { video?: VideoItem }) {
  const { run, busy } = usePending();
  const [share, setShare] = useState<Share | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const shareable = video?.kind === "mp4" && video.state === "ready";

  useEffect(() => {
    if (!shareable || !video) return;
    void api<{ share: Share | null }>(`/api/videos/${video.id}/share`).then((res) => { if (res.ok) setShare(res.data.share); setLoaded(true); });
  }, [video, shareable]);

  if (!shareable || !video) return <Panel kicker="Share" title="Share"><Notice>Only a finished film that passed QA can be shared. Previews stay private.</Notice></Panel>;

  const create = () => run("create", async () => {
    setError("");
    const res = await api<{ share: Share }>(`/api/videos/${video.id}/share`, { body: { allowDownload: false } });
    if (!res.ok) { setError(res.error); return; }
    setShare(res.data.share);
    setNote("Share link ready.");
  });
  const toggle = (allowDownload: boolean) => run("toggle", async () => {
    // Show the new state at once; put it back if the save fails.
    setShare((current) => (current ? { ...current, allowDownload } : current));
    const res = await api<{ share: Share }>(`/api/videos/${video.id}/share`, { method: "PATCH", body: { allowDownload } });
    if (!res.ok) { setError(res.error); setShare((current) => (current ? { ...current, allowDownload: !allowDownload } : current)); return; }
    setShare(res.data.share);
    setNote(allowDownload ? "Viewers can now download the MP4." : "Downloads are off.");
  });
  const revoke = () => run("revoke", async () => {
    if (!confirm("Revoke this link? Anyone who has it will no longer be able to watch.")) return;
    const res = await api(`/api/videos/${video.id}/share`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    setShare(null);
    setNote("Link revoked. It no longer opens.");
  });

  return (
    <Panel kicker={`Version ${video.version}`} title="Share this film">
      <p className="fine">Anyone with the link can watch this version. They do not see your script, storyboard or other versions.</p>
      {!loaded ? <p className="fine">Checking for a link</p> : share ? (
        <>
          <CopyRow value={share.url} name="Share link" />
          <label className="row-actions fine">
            <input type="checkbox" checked={share.allowDownload} onChange={(e) => void toggle(e.target.checked)} />
            Let viewers download the MP4
          </label>
          <div className="row-actions">
            <a className="btn ghost sm" href={share.url} target="_blank" rel="noreferrer">Open</a>
            <Button tone="danger" size="sm" pending={busy("revoke")} onClick={() => void revoke()}>Revoke link</Button>
            <span className="fine mono">{share.views} views</span>
          </div>
        </>
      ) : <Button tone="accent" pending={busy("create")} onClick={() => void create()}>Make a share link</Button>}
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </Panel>
  );
}
