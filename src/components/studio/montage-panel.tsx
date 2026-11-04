"use client";

import { useEffect, useState } from "react";

type Asset = { id: string; name: string; kind: string; licence: string; mine?: boolean };

export function MontagePanel({ projectId, onQueued, disabled }: { projectId: string; onQueued: (jobId: string) => void; disabled: boolean }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clips, setClips] = useState<string[]>([]);
  const [music, setMusic] = useState<string>("");
  const [seconds, setSeconds] = useState(15);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  async function reload() {
    const response = await fetch("/api/library/assets");
    if (response.ok) setAssets(((await response.json()).items || []).filter((item: Asset) => item.mine));
  }

  useEffect(() => {
    fetch("/api/library/assets").then(async (response) => {
      if (response.ok) setAssets(((await response.json()).items || []).filter((item: Asset) => item.mine));
    });
  }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/library/assets", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error?.message || `Could not upload ${file.name}.`);
      else if (body?.asset?.kind === "audio") setMusic(body.asset.id);
      else if (body?.asset?.id) setClips((current) => [...current, body.asset.id]);
    }
    setUploading(false);
    await reload();
  }

  async function render() {
    setError("");
    setNote("");
    const response = await fetch(`/api/projects/${projectId}/montage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetIds: clips, musicAssetId: music || null, seconds }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not start the montage.");
      return;
    }
    setNote("Montage queued");
    onQueued(body.jobId);
  }

  const visuals = assets.filter((item) => item.kind === "image" || item.kind === "video");
  const tracks = assets.filter((item) => item.kind === "audio");

  return (
    <div className="surface panel" aria-label="Montage">
      <div>
        <p className="kicker">Montage</p>
        <h2>Pick photos, clips and music</h2>
        <p className="fine">Cuts land on the beats measured from your music. Clips play in the order you pick them. Your originals are never changed.</p>
      </div>
      <label className="fine">Upload photos, clips or music (PNG, JPEG, WebP, MP4, MP3, WAV up to 25 MB)
        <input type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/wav" disabled={uploading} onChange={(event) => { const files = event.currentTarget.files; void upload(files); event.currentTarget.value = ""; }} />
      </label>
      <div>
        <p className="kicker">Photos and clips · {clips.length} picked</p>
        {visuals.length === 0 ? <p className="fine">Nothing uploaded yet.</p> : visuals.map((item) => (
          <label key={item.id} className="list-row">
            <span className="row-actions"><input type="checkbox" checked={clips.includes(item.id)} onChange={(event) => setClips((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} aria-label={`Use ${item.name}`} />{item.name}</span>
            <span className="fine mono">{item.kind}{clips.includes(item.id) ? ` · #${clips.indexOf(item.id) + 1}` : ""}</span>
          </label>
        ))}
      </div>
      <div>
        <p className="kicker">Music</p>
        <label className="list-row"><span className="row-actions"><input type="radio" name="music" checked={!music} onChange={() => setMusic("")} />No music (silent, even cuts)</span></label>
        {tracks.map((item) => (
          <label key={item.id} className="list-row"><span className="row-actions"><input type="radio" name="music" checked={music === item.id} onChange={() => setMusic(item.id)} aria-label={`Music ${item.name}`} />{item.name}</span></label>
        ))}
      </div>
      <label className="stack-label">Length
        <select className="field" aria-label="Montage length" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
          {[10, 15, 20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} seconds</option>)}
        </select>
      </label>
      <div className="row-actions">
        <button className="btn accent" type="button" disabled={disabled || uploading || clips.length === 0} onClick={() => void render()}>Render montage</button>
        {note ? <span className="fine" role="status">{note}</span> : null}
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
