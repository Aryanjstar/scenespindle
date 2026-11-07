"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../../components/studio/studio-bar";
import { api, usePending } from "../../../components/ui/client";
import { Button, Empty, Notice, Panel, timeAgo } from "../../../components/ui/kit";

type Item = { id: string; title: string; logline: string; mode: string; version: number; updatedAt?: string };

export default function SeriesPage() {
  const router = useRouter();
  const { run, busy } = usePending();
  const [items, setItems] = useState<Item[] | null>(null);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [mode, setMode] = useState("story");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ items: Item[] }>("/api/series").then((res) => { if (!res.ok) setError(res.error); setItems(res.ok ? res.data.items : []); });
  }, []);

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void run("create", async () => {
      setError("");
      const res = await api<{ series: Item }>("/api/series", { body: { title, logline, mode } });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/studio/series/${res.data.series.id}`);
    });
  };

  return (
    <main className="app">
      <StudioBar />
      <div className="page-head"><div><p className="kicker">Recurring cast and world</p><h1>Series</h1></div></div>
      <Panel kicker="New series" title="Start a series">
        <form onSubmit={create} className="stack-label">
          <div className="split">
            <label className="stack-label">Title<input aria-label="Title" className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Tikku's town" required minLength={2} /></label>
            <label className="stack-label">Kind<select aria-label="Kind" className="field" value={mode} onChange={(e) => setMode(e.target.value)}><option value="story">Story</option><option value="cartoon">Cartoon</option></select></label>
          </div>
          <label className="stack-label">Logline<input aria-label="Logline" className="field" value={logline} maxLength={400} onChange={(e) => setLogline(e.target.value)} placeholder="A curious boy learns one safety rule each episode" /></label>
          <Button tone="accent" type="submit" pending={busy("create")} disabled={title.trim().length < 2}>Create series</Button>
        </form>
        <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      </Panel>
      {items === null ? <div className="surface panel skeleton" /> : !items.length ? <Empty title="No series yet"><p className="fine">A series keeps one cast, world and tone across numbered episodes.</p></Empty> : (
        <section className="cards">
          {items.map((item) => (
            <Link key={item.id} href={`/studio/series/${item.id}`} className="surface card" data-mode={item.mode}>
              <div className="card-poster"><span className="poster-glyph">{item.mode === "cartoon" ? "☺" : "★"}</span><span className="sticker tag">{item.mode === "cartoon" ? "Cartoon" : "Story"}</span></div>
              <div className="card-top"><strong>{item.title}</strong><span className="badge" data-tone={item.version ? "ready" : "draft"}>{item.version ? `v${item.version}` : "draft"}</span></div>
              <span className="fine">{item.logline || "No logline"} · {timeAgo(item.updatedAt)}</span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
