"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../../components/studio/studio-bar";

type SeriesItem = { id: string; title: string; logline: string; mode: string; version: number };

export default function SeriesPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [items, setItems] = useState<SeriesItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [mode, setMode] = useState("story");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/session").then(async (response) => {
      if (!response.ok) { router.replace("/sign-in"); return; }
      setName((await response.json()).user.name);
      const list = await fetch("/api/series");
      if (list.ok) setItems((await list.json()).items || []);
    });
  }, [router]);

  return (
    <main className="app">
      <StudioBar name={name} />
      <div className="page-head">
        <div>
          <p className="kicker">Series</p>
          <h1>A cast that stays put</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>Approve the bible once. Episodes keep that cast and those rules.</p>
        </div>
      </div>
      {error ? <p className="notice bad" role="alert">{error}</p> : null}
      <div className="split">
        <form className="surface panel" onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const response = await fetch("/api/series", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, logline, mode, style: mode === "cartoon" ? "cartoon" : "storybook" }),
          });
          const body = await response.json();
          if (!response.ok) { setError(body?.error?.message || "Could not create that series."); return; }
          router.push(`/studio/series/${body.series.id}`);
        }}>
          <p className="kicker">New</p>
          <h2>Start a series</h2>
          <label className="stack-label">Title
            <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} aria-label="Series title" />
          </label>
          <label className="stack-label">Logline
            <input className="field" value={logline} onChange={(event) => setLogline(event.target.value)} aria-label="Logline" />
          </label>
          <label className="stack-label">Mode
            <select className="field" aria-label="Series mode" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="story">Story</option>
              <option value="cartoon">Cartoon</option>
            </select>
          </label>
          <button className="btn" type="submit">Create series</button>
        </form>
        <section className="surface panel" aria-label="Your series">
          <h2>Your series</h2>
          {items === null ? <p className="fine">Loading</p> : items.length === 0 ? <p className="fine">None yet.</p> : (
            <div className="episodes">
              {items.map((item) => (
                <Link key={item.id} className="episode" href={`/studio/series/${item.id}`}>
                  <b>{item.version || 0}</b>
                  <span><strong>{item.title}</strong><span className="fine">{item.logline || item.mode}</span></span>
                  <span className="badge">{item.mode}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
