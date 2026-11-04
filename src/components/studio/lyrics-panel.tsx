"use client";

import { useEffect, useState } from "react";

type Song = { id: string; name: string; kind?: string };

export function LyricsPanel({ projectId, revision, initialLrc, onBuilt }: { projectId: string; revision: number; initialLrc: string; onBuilt: () => Promise<void> }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [songId, setSongId] = useState("");
  const [lrc, setLrc] = useState(initialLrc);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/library/assets").then(async (response) => {
      if (!response.ok) return;
      const items = ((await response.json()).items || []) as Song[];
      const audio = items.filter((item) => item.kind === "audio");
      setSongs(audio);
      setSongId((current) => current || audio[0]?.id || "");
    });
  }, []);

  async function build(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    setBusy(true);
    const response = await fetch(`/api/projects/${projectId}/lyrics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ songAssetId: songId, lrc, expectedRevision: revision }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body?.error?.message || "Could not build the lyric storyboard.");
      return;
    }
    setStatus(`${body.lines} lines across ${body.scenes} scenes, timed from the file.`);
    await onBuilt();
  }

  return (
    <section className="surface panel" aria-label="Lyrics">
      <div>
        <p className="kicker">Lyrics</p>
        <h2>Song and timed words</h2>
        <p className="fine">Upload the song in the library, then paste an LRC file. Each line appears when it is sung.</p>
      </div>
      <form onSubmit={build} className="stack-label">
        <label className="stack-label">Song
          <select className="field" aria-label="Song" value={songId} onChange={(event) => setSongId(event.target.value)}>
            {songs.length === 0 ? <option value="">No audio in the library</option> : null}
            {songs.map((song) => <option key={song.id} value={song.id}>{song.name}</option>)}
          </select>
        </label>
        <label className="stack-label">LRC
          <textarea className="field mono" aria-label="Timed lyrics" value={lrc} onChange={(event) => setLrc(event.target.value)} placeholder={"[00:01.20] First line"} style={{ minHeight: 160 }} />
        </label>
        <button className="btn" type="submit" disabled={busy || !songId || lrc.trim().length < 8}>Build lyric storyboard</button>
      </form>
      {status ? <p className="ok" role="status">{status}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
