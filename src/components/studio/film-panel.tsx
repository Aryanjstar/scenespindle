"use client";

import { useEffect, useState } from "react";

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

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function FilmPanel({ videos, selectedId, onSelect }: { videos: VideoItem[]; selectedId: string; onSelect: (id: string) => void }) {
  const video = videos.find((item) => item.id === selectedId) ?? videos[0];
  const [sheetFor, setSheetFor] = useState("");
  const showSheet = Boolean(video) && sheetFor === video?.id;
  if (!video) {
    return <div className="empty">No film yet. Approve the storyboard to render one.</div>;
  }
  return (
    <div className="panel surface">
      <div className="film">
        {video.kind === "mp4" && video.files && video.state !== "failed" ? (
          <video key={video.id} controls playsInline preload="metadata" poster={video.files.thumb} aria-label={`Film version ${video.version}`}>
            <source src={video.files.mp4} type="video/mp4" />
            {video.files.vtt ? <track kind="captions" src={video.files.vtt} srcLang="en" label="Captions" /> : null}
          </video>
        ) : video.kind === "mp4" && video.files ? (
          <video key={video.id} controls playsInline preload="metadata" poster={video.files.thumb} src={video.files.mp4} aria-label={`Failed render version ${video.version}`} />
        ) : (
          <iframe className="player" title="Preview" sandbox="allow-scripts" src={video.previewUrl} />
        )}
        <div className="film-side">
          <div>
            <p className="kicker">Version {video.version}{video.current ? " · current" : ""}</p>
            <h2>{video.kind === "mp4" ? (video.state === "ready" ? "Film ready" : "Render did not pass QA") : "Silent preview"}</h2>
          </div>
          {video.kind === "preview" ? <p className="notice">This is a silent HTML preview with estimated timing. Render the film for narration, captions and an MP4.</p> : null}
          {video.warnings.map((warning) => <p key={warning} className="notice warn">{warning}</p>)}
          <dl className="meta">
            <dt>Length</dt><dd className="mono">{seconds(video.durationMs)}</dd>
            {video.voiceId ? <><dt>Narrator</dt><dd>{video.voiceId}</dd></> : null}
            {video.timing ? <><dt>Caption timing</dt><dd>{video.timing === "aligned" ? "From the voice provider" : "Estimated"}</dd></> : null}
            {video.createdAt ? <><dt>Made</dt><dd>{new Date(video.createdAt).toLocaleString()}</dd></> : null}
          </dl>
          {video.files ? (
            <div className="row-actions" aria-label="Downloads">
              <a className="btn sm" href={`${video.files.mp4}?download=1`}>Download MP4</a>
              {video.files.srt ? <a className="btn ghost sm" href={`${video.files.srt}?download=1`}>SRT</a> : null}
              {video.files.vtt ? <a className="btn ghost sm" href={`${video.files.vtt}?download=1`}>VTT</a> : null}
              <button className="btn ghost sm" type="button" onClick={() => setSheetFor(showSheet ? "" : video.id)}>{showSheet ? "Hide frames" : "Frame sheet"}</button>
            </div>
          ) : null}
          {video.qa ? (
            <div>
              <p className="kicker">Automatic checks · {video.qa.passed ? "passed" : "failed"}</p>
              <div className="qa">
                {video.qa.checks.map((check) => (
                  <div key={check.name}>
                    <span className={check.ok ? "" : "error"}>{check.ok ? "✓" : "✕"} {check.name}</span>
                    <span className="mono">{check.detail}</span>
                  </div>
                ))}
              </div>
              <p className="fine">Automatic checks cover streams, size, length and loudness. Watch the film and look at the frame sheet before you share it.</p>
            </div>
          ) : null}
          {showSheet && video.files ? <img className="sheet" src={video.files.sheet} alt={`Eight frames sampled across version ${video.version}`} /> : null}
        </div>
      </div>
      {videos.length > 1 ? (
        <div>
          <p className="kicker">Versions</p>
          <div className="versions">
            {videos.map((item) => (
              <button key={item.id} type="button" className={item.id === video.id ? "version is-on" : "version"} onClick={() => onSelect(item.id)}>
                <span>v{item.version} · {item.kind === "mp4" ? "Film" : "Preview"}{item.current ? " · current" : ""}</span>
                <span className="badge" data-tone={item.state === "ready" ? "ready" : item.state === "failed" ? "failed" : "review"}>{item.state}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SharePanel({ video }: { video?: VideoItem }) {
  const [share, setShare] = useState<{ url: string; allowDownload: boolean; views: number } | null>(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const shareable = video?.kind === "mp4" && video.state === "ready";

  // The parent keys this panel by video id, so state starts fresh for each version.
  useEffect(() => {
    if (!shareable || !video) return;
    fetch(`/api/videos/${video.id}/share`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setShare(body.share);
      setAllowDownload(Boolean(body.share?.allowDownload));
    });
  }, [video, shareable]);

  if (!shareable || !video) {
    return (
      <div className="panel surface">
        <h2>Share</h2>
        <p className="notice">Only a finished film that passed QA can be shared. Previews stay private.</p>
      </div>
    );
  }

  async function create(download = allowDownload) {
    setError("");
    const response = await fetch(`/api/videos/${video!.id}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowDownload: download }) });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not make a share link.");
      return;
    }
    setShare(body.share);
    setNote(share ? "Link updated" : "Share link ready");
  }

  async function revoke() {
    const response = await fetch(`/api/videos/${video!.id}/share`, { method: "DELETE" });
    if (response.status === 204) {
      setShare(null);
      setNote("Link revoked. It no longer opens.");
    }
  }

  return (
    <div className="panel surface share-box">
      <div>
        <p className="kicker">Version {video.version}</p>
        <h2>Share this film</h2>
      </div>
      <p className="fine">Anyone with the link can watch this version. They do not see your script, storyboard or other versions.</p>
      <label className="row-actions fine">
        <input type="checkbox" checked={allowDownload} onChange={(event) => { setAllowDownload(event.target.checked); if (share) void create(event.target.checked); }} />
        Let viewers download the MP4
      </label>
      {share ? (
        <>
          <div className="copy-row">
            <input className="field" aria-label="Share link" readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} />
            <button className="btn ghost" type="button" onClick={() => { void navigator.clipboard?.writeText(share.url); setNote("Copied"); }}>Copy</button>
          </div>
          <div className="row-actions">
            <a className="btn ghost sm" href={share.url} target="_blank" rel="noreferrer">Open</a>
            <button className="btn danger sm" type="button" onClick={() => void revoke()}>Revoke link</button>
            <span className="fine mono">{share.views} views</span>
          </div>
        </>
      ) : (
        <button className="btn accent" type="button" onClick={() => void create()}>Make a share link</button>
      )}
      {note ? <p className="fine" role="status">{note}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
