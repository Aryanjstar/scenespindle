"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../components/studio/studio-bar";
import { api, newKey, usePending } from "../../components/ui/client";
import { Button, Empty, MODE_LABEL, Notice, timeAgo } from "../../components/ui/kit";

type Card = { id: string; title: string; mode: string; format: string; badge: string; targetMs?: number; updatedAt?: string; poster?: string; deletedAt?: string };
type Mode = { id: string; label: string; available: boolean; note?: string };

const GLYPH: Record<string, string> = { explainer: "?", code_lab: "{ }", audio: "♪", story: "★", cartoon: "☺", lyrics: "♫", montage: "▦", reel: "Aa" };
const STARTERS: Record<string, string[]> = {
  explainer: ["Why ice floats on water", "Why the sky looks blue"],
  code_lab: ["How binary search finds one name", "How fib(4) calls itself"],
  story: ["A grandmother teaches her grandson to fly a kite"],
  cartoon: ["Tikku learns to cross the road safely"],
  audio: ["A one minute pep talk for exam week"],
  lyrics: ["My song with its words on screen"],
  montage: ["A day in my life, exam season"],
  reel: ["Captions for my talking reel"],
};
const FILTERS = [
  { id: "all", label: "All" }, { id: "draft", label: "Drafts" }, { id: "review", label: "In review" },
  { id: "rendering", label: "Rendering" }, { id: "ready", label: "Ready" }, { id: "failed", label: "Failed" },
];

export default function StudioPage() {
  const router = useRouter();
  const { run, busy } = usePending();
  const [name, setName] = useState("");
  const [items, setItems] = useState<Card[] | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("explainer");
  const [modes, setModes] = useState<Mode[]>([]);
  const [deleted, setDeleted] = useState<Card[] | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: Card[] }>("/api/projects");
    if (!res.ok) { setError(res.error); setItems([]); return; }
    setItems(res.data.items);
  }, []);

  useEffect(() => {
    void (async () => {
      const session = await api<{ user: { name: string } }>("/api/auth/session");
      if (!session.ok) { router.replace("/sign-in"); return; }
      setName(session.data.user.name);
      await load();
      const catalog = await api<{ modes: Mode[] }>("/api/catalog");
      if (catalog.ok) setModes(catalog.data.modes);
    })();
  }, [router, load]);

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void run("create", async () => {
      setError("");
      const res = await api<{ project: { id: string } }>("/api/projects", { body: { mode, topic, title: topic.slice(0, 80) || `New ${MODE_LABEL[mode] ?? "film"}` }, idempotencyKey: newKey() });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/studio/p/${res.data.project.id}`);
    });
  };

  async function loadDeleted() {
    const res = await api<{ items: Card[] }>("/api/projects?deleted=1");
    setDeleted(res.ok ? res.data.items : []);
  }

  const remove = (item: Card) => run(`del-${item.id}`, async () => {
    if (!confirm(`Delete “${item.title}”? Share links stop working now. You can restore it for 7 days.`)) return;
    const res = await api(`/api/projects/${item.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    setItems((current) => (current ?? []).filter((card) => card.id !== item.id));
    if (deleted) void loadDeleted();
  });

  const duplicate = (item: Card) => run(`dup-${item.id}`, async () => {
    const res = await api<{ project: { id: string } }>(`/api/projects/${item.id}/duplicate`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });

  const restore = (item: Card) => run(`restore-${item.id}`, async () => {
    const res = await api(`/api/projects/${item.id}/restore`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setDeleted((current) => (current ?? []).filter((card) => card.id !== item.id));
    await load();
  });

  const shown = (items ?? []).filter((item) => (filter === "all" || item.badge === filter) && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())));
  const modeList: Mode[] = modes.length ? modes : Object.keys(MODE_LABEL).map((id) => ({ id, label: MODE_LABEL[id], available: true }));
  const selected = modeList.find((m) => m.id === mode);

  return (
    <main className="app">
      <StudioBar name={name} />
      <div className="page-head">
        <div>
          <p className="kicker">{name ? `Namaste, ${name.split(" ")[0]}` : "Studio"}</p>
          <h1>What shall we make?</h1>
        </div>
      </div>

      <form onSubmit={create} className="surface composer" data-mode={mode}>
        <div className="mode-grid" role="radiogroup" aria-label="Kind of film">
          {modeList.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} data-mode={item.id} disabled={!item.available} className={`mode-card ${mode === item.id ? "is-on" : ""}`} onClick={() => setMode(item.id)}>
              <span className="mode-glyph" aria-hidden="true">{GLYPH[item.id] ?? "•"}</span>
              <span className="mode-name">{item.label}</span>
            </button>
          ))}
        </div>
        {selected?.note ? <p className="mode-note">{selected.note}</p> : null}
        <div className="composer-row">
          <input className="field" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={mode === "montage" || mode === "reel" || mode === "lyrics" ? "Give it a name" : "A topic, in one sentence"} aria-label="Topic or name for the new project" maxLength={2000} />
          <Button tone="accent" size="lg" type="submit" pending={busy("create")}>Start</Button>
        </div>
        <div className="chips" aria-label="Examples">
          {(STARTERS[mode] ?? []).map((prompt) => <button key={prompt} className="chip" type="button" onClick={() => setTopic(prompt)}>{prompt}</button>)}
        </div>
        <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      </form>

      <div className="toolbar">
        <div className="chips" aria-label="Filter">
          {FILTERS.map((item) => (
            <button key={item.id} className={filter === item.id ? "chip is-on" : "chip"} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
        <input className="field search" type="search" placeholder="Search projects" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {items === null ? (
        <div className="cards" aria-busy="true">{[0, 1, 2].map((n) => <div key={n} className="surface card skeleton" />)}</div>
      ) : shown.length === 0 ? (
        <Empty title={items.length ? "Nothing in this view" : "Your first film starts above"}>{items.length ? <p className="fine">Try another filter.</p> : <p className="fine">Pick a kind of film, write one line, and press Start.</p>}</Empty>
      ) : (
        <section className="cards">
          {shown.map((item) => (
            <article key={item.id} className="surface card" data-mode={item.mode}>
              <Link href={`/studio/p/${item.id}`} className={`card-poster ${item.format === "16x9" ? "wide" : ""}`} aria-label={`Open ${item.title}`}>
                {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span className="poster-glyph">{GLYPH[item.mode] ?? "•"}</span>}
                <span className="sticker tag">{MODE_LABEL[item.mode] ?? item.mode}</span>
              </Link>
              <div className="card-top">
                <Link href={`/studio/p/${item.id}`}>{item.title}</Link>
                <span className="badge" data-tone={item.badge}>{item.badge}</span>
              </div>
              <div className="card-foot">
                <span className="fine mono">{item.format.replace("x", ":")}{item.targetMs ? ` · ${Math.round(item.targetMs / 1000)}s` : ""} · {timeAgo(item.updatedAt)}</span>
                <span className="row-actions">
                  <Button tone="quiet" size="sm" pending={busy(`dup-${item.id}`)} onClick={() => void duplicate(item)} aria-label={`Duplicate ${item.title}`}>Duplicate</Button>
                  <Button tone="quiet" size="sm" pending={busy(`del-${item.id}`)} onClick={() => void remove(item)} aria-label={`Delete ${item.title}`}>Delete</Button>
                </span>
              </div>
            </article>
          ))}
        </section>
      )}

      <div className="toolbar">
        <Button tone="quiet" size="sm" aria-expanded={deleted !== null} onClick={() => (deleted === null ? void loadDeleted() : setDeleted(null))}>{deleted !== null ? "Hide recently deleted" : "Recently deleted"}</Button>
      </div>
      {deleted !== null ? (
        <section className="surface panel" aria-label="Recently deleted">
          <p className="fine">Deleted projects stay here for 7 days, then they and their films are erased. Restoring does not bring back old share links.</p>
          {deleted.length === 0 ? <p className="fine">Nothing deleted in the last 7 days.</p> : deleted.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.title}</span>
              <span className="row-actions">
                <span className="fine mono">{timeAgo(item.deletedAt)}</span>
                <Button tone="ghost" size="sm" pending={busy(`restore-${item.id}`)} onClick={() => void restore(item)}>Restore</Button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
