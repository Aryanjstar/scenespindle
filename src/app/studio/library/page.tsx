"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "../../../components/brand";

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

  // reload awaits fetch before updating state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, []);

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
      <header className="site-bar">
        <Brand href="/studio" />
        <Link href="/studio">Projects</Link>
      </header>
      <section className="glass panel">
        <p className="kicker">Characters</p>
        <form onSubmit={createCharacter} className="row-actions">
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Original name" />
          <button className="btn" type="submit">Add</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <div className="cards">
          {characters.map((character) => (
            <article key={character.id} className="clay card"><strong>{character.name}</strong><span className="fine">{character.style}</span></article>
          ))}
        </div>
      </section>
      <section className="glass panel">
        <p className="kicker">Assets</p>
        <input type="file" accept="image/*,audio/*,video/*" onChange={(event) => void upload(event)} />
        <ul>
          {assets.map((asset) => (
            <li key={asset.id}>{asset.name} · {asset.kind} · {asset.licence}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
