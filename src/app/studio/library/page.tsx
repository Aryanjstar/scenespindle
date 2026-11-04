"use client";

import { useEffect, useState } from "react";
import { StudioBar } from "../../../components/studio/studio-bar";

type Item = { id: string; name: string; kind?: string; licence?: string; style?: string; description?: string };

export default function LibraryPage() {
  const [assets, setAssets] = useState<Item[]>([]);
  const [characters, setCharacters] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const [assetResponse, characterResponse] = await Promise.all([fetch("/api/library/assets"), fetch("/api/characters")]);
    if (assetResponse.ok) setAssets((await assetResponse.json()).items || []);
    if (characterResponse.ok) setCharacters((await characterResponse.json()).items || []);
  }

  useEffect(() => {
    Promise.all([fetch("/api/library/assets"), fetch("/api/characters")]).then(async ([assetResponse, characterResponse]) => {
      if (assetResponse.ok) setAssets((await assetResponse.json()).items || []);
      if (characterResponse.ok) setCharacters((await characterResponse.json()).items || []);
    });
  }, []);

  async function createCharacter(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/characters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, style: "cartoon", description: "An original character." }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body?.error?.message || "Could not create that character.");
      return;
    }
    setName("");
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
            <p className="fine">Original characters only. Protected names are refused. Characters are not drawn in films yet.</p>
          </div>
          <form onSubmit={createCharacter} className="copy-row">
            <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Original name" aria-label="Character name" />
            <button className="btn" type="submit" disabled={name.trim().length < 2}>Add</button>
          </form>
          {characters.length === 0 ? <p className="fine">No characters yet.</p> : characters.map((character) => (
            <div key={character.id} className="list-row"><span>{character.name}</span><span className="badge">{character.style}</span></div>
          ))}
        </section>
        <section className="surface panel" aria-label="Assets">
          <div>
            <h2>Assets</h2>
            <p className="fine">Images, audio or video up to 8 MB. Stored privately with the rights you claim. Not used by the renderer yet.</p>
          </div>
          <label className="fine">Upload a file
            <input type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,video/mp4" onChange={(event) => void upload(event)} />
          </label>
          {assets.map((asset) => (
            <div key={asset.id} className="list-row"><span>{asset.name}</span><span className="fine mono">{asset.kind} · {asset.licence}</span></div>
          ))}
        </section>
      </div>
    </main>
  );
}
