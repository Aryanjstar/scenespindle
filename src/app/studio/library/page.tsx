"use client";

import { useEffect, useState } from "react";
import { StudioBar } from "../../../components/studio/studio-bar";

type Item = { id: string; name: string; kind?: string; licence?: string; style?: string; description?: string; state?: string; sheetUrl?: string | null };
type CaptionResult = { id: string; name: string; url: string; timing: string; cues: number; band: string };

export default function LibraryPage() {
  const [assets, setAssets] = useState<Item[]>([]);
  const [characters, setCharacters] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [videos, setVideos] = useState<Item[]>([]);
  const [captionAsset, setCaptionAsset] = useState("");
  const [captionText, setCaptionText] = useState("");
  const [band, setBand] = useState("lower");
  const [captioned, setCaptioned] = useState<CaptionResult | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);

  async function reload() {
    const [assetResponse, characterResponse] = await Promise.all([fetch("/api/library/assets"), fetch("/api/characters")]);
    if (assetResponse.ok) {
      const items = (await assetResponse.json()).items || [];
      setAssets(items);
      setVideos(items.filter((item: Item) => item.kind === "video" && item.id.length === 24));
    }
    if (characterResponse.ok) setCharacters((await characterResponse.json()).items || []);
  }

  useEffect(() => {
    Promise.all([fetch("/api/library/assets"), fetch("/api/characters")]).then(async ([assetResponse, characterResponse]) => {
      if (assetResponse.ok) {
      const items = (await assetResponse.json()).items || [];
      setAssets(items);
      setVideos(items.filter((item: Item) => item.kind === "video" && item.id.length === 24));
    }
      if (characterResponse.ok) setCharacters((await characterResponse.json()).items || []);
    });
  }, []);

  async function createCharacter(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, style: "cartoon", description: description || "An original character.", draw: false }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not create that character.");
      return;
    }
    setName("");
    setDescription("");
    setError("");
    await reload();
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/library/assets", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) setError(body?.error?.message || "Could not upload.");
    else await reload();
  }

  return (
    <main className="app">
      <StudioBar />
      <div className="page-head">
        <div>
          <p className="kicker">Library</p>
          <h1>Characters and assets</h1>
        </div>
      </div>
      {error ? <p className="notice bad" role="alert">{error}</p> : null}
      <div className="split">
        <section className="surface panel" aria-label="Characters">
          <div>
            <h2>Characters</h2>
            <p className="fine">Original characters only. Protected names are refused. Story and Cartoon films perform them on the 3D stage: head, mouth and body.</p>
          </div>
          <form onSubmit={createCharacter} className="stack-label">
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Original name" aria-label="Character name" />
            <input className="field" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="How they look, in a sentence" aria-label="Character description" />
            <button className="btn" type="submit" disabled={name.trim().length < 2}>Add</button>
          </form>
          {characters.length === 0 ? <p className="fine">No characters yet.</p> : (
            <div className="gallery">
              {characters.map((character) => (
                <article key={character.id} className="surface char-card">
                  <div className="portrait">{character.sheetUrl ? <img src={character.sheetUrl} alt="" /> : character.name.slice(0, 1)}</div>
                  <strong>{character.name}</strong>
                  <span className="fine">{character.description || character.style}</span>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="surface panel" aria-label="Assets">
          <div>
            <h2>Assets</h2>
            <p className="fine">Images, audio or video up to 25 MB. Songs feed lyric films. Videos can be captioned below. Stored privately with the rights you claim.</p>
          </div>
          <label className="fine">Upload a file
            <input type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,video/mp4" onChange={(event) => void upload(event)} />
          </label>
          {assets.map((asset) => (
            <div key={asset.id} className="list-row"><span>{asset.name}</span><span className="fine mono">{asset.kind} · {asset.licence}</span></div>
          ))}
        </section>
        <section className="surface panel" aria-label="Caption a reel">
          <div>
            <h2>Caption a reel</h2>
            <p className="fine">Upload an MP4 above, then paste an SRT, an LRC, or one line per caption. Plain lines are spaced evenly across the reel. SRT and LRC keep their own times. Captions are outlined type in the band you pick.</p>
          </div>
          <form className="stack-label" onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setCaptioned(null);
            setCaptionBusy(true);
            const response = await fetch("/api/captions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ assetId: captionAsset, text: captionText, band }),
            });
            const body = await response.json();
            setCaptionBusy(false);
            if (!response.ok) { setError(body?.error?.message || "Could not caption that reel."); return; }
            setCaptioned(body.asset);
            await reload();
          }}>
            <label className="stack-label">Reel
              <select className="field" aria-label="Reel" value={captionAsset} onChange={(event) => setCaptionAsset(event.target.value)}>
                <option value="">Choose an uploaded video</option>
                {videos.map((video) => <option key={video.id} value={video.id}>{video.name}</option>)}
              </select>
            </label>
            <label className="stack-label">Band
              <select className="field" aria-label="Caption band" value={band} onChange={(event) => setBand(event.target.value)}>
                <option value="lower">Lower third</option>
                <option value="middle">Middle</option>
                <option value="upper">Upper third</option>
              </select>
            </label>
            <label className="stack-label">Words
              <textarea className="field" aria-label="Caption text" value={captionText} onChange={(event) => setCaptionText(event.target.value)} placeholder={"1\n00:00:01,000 --> 00:00:03,000\nThe line goes here"} style={{ minHeight: 140 }} />
            </label>
            <button className="btn" type="submit" disabled={captionBusy || !captionAsset || captionText.trim().length < 1}>{captionBusy ? "Captioning" : "Burn captions"}</button>
          </form>
          {captioned ? <p className="ok" role="status">{captioned.cues} cues, {captioned.timing === "file" ? "timed from the file" : "spaced evenly"}. <a href={`${captioned.url}?download=1`}>Download</a></p> : null}
        </section>
      </div>
    </main>
  );
}
