"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StudioBar } from "../../components/studio/studio-bar";

type Card = { id: string; title: string; mode: string; format: string; badge: string; targetMs?: number; updatedAt?: string; poster?: string; deletedAt?: string };
type Mode = { id: string; label: string; available: boolean; reason?: string };

const prompts = ["Why ice floats on water", "How binary search finds one name", "Why the sky looks blue"];
const FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "review", label: "In review" },
  { id: "ready", label: "Ready" },
  { id: "failed", label: "Failed" },
];

export default function StudioPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [items, setItems] = useState<Card[] | null>(null);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("explainer");
  const [modes, setModes] = useState<Mode[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleted, setDeleted] = useState<Card[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session").then(async (response) => {
      if (!response.ok) {
        router.replace("/sign-in");
        return;
      }
      const body = await response.json();
      setName(body.user.name);
      const projects = await fetch("/api/projects");
      const list = await projects.json();
      if (!projects.ok) {
        setError(list?.error?.message || "Could not load projects.");
        setItems([]);
        return;
      }
      setItems(list.items || []);
    });
    fetch("/api/catalog").then(async (response) => {
      if (response.ok) setModes((await response.json()).modes || []);
    });
  }, [router]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setCreating(true);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, topic, title: topic.slice(0, 80) || "Untitled" }),
    });
    const body = await response.json();
    setCreating(false);
    if (!response.ok) {
      setError(body?.error?.message || "Could not create that project.");
      return;
    }
    router.push(`/studio/p/${body.project.id}`);
  }

  async function loadDeleted() {
    const response = await fetch("/api/projects?deleted=1");
    if (response.ok) setDeleted((await response.json()).items || []);
  }

  async function restore(item: Card) {
    const response = await fetch(`/api/projects/${item.id}/restore`, { method: "POST" });
    if (!response.ok) {
      setError("Could not restore that project.");
      return;
    }
    setDeleted((current) => current.filter((card) => card.id !== item.id));
    const list = await fetch("/api/projects");
    if (list.ok) setItems((await list.json()).items || []);
  }

  async function remove(item: Card) {
    if (!confirm(`Delete “${item.title}”? Share links stop working now. The project can be recovered for 7 days.`)) return;
    const response = await fetch(`/api/projects/${item.id}`, { method: "DELETE" });
    if (response.status === 204) {
      setItems((current) => (current ?? []).filter((card) => card.id !== item.id));
      if (showDeleted) void loadDeleted();
    }
    else setError("Could not delete that project.");
  }

  const shown = (items ?? []).filter((item) => (filter === "all" || item.badge === filter) && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())));

  return (
    <main className="app">
      <StudioBar name={name} />

      <div className="page-head">
        <div>
          <p className="kicker">Studio</p>
          <h1>Projects</h1>
        </div>
      </div>

      <form onSubmit={create} className="surface composer">
        <h2>What shall we make?</h2>
        <div className="composer-row">
          <input className="field" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="A topic, in one sentence" aria-label="Topic for a new project" maxLength={2000} />
          <button className="btn accent" type="submit" disabled={creating}>Start</button>
        </div>
        <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <div className="chips" aria-label="Mode">
            {(modes.length ? modes : [{ id: "explainer", label: "Explainer", available: true }, { id: "code_lab", label: "Code Lab", available: true }]).map((item) => (
              <button key={item.id} className={mode === item.id ? "chip is-on" : "chip"} type="button" disabled={!item.available} title={item.reason} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="chips" aria-label="Examples">
            {prompts.map((prompt) => (
              <button key={prompt} className="chip" type="button" onClick={() => setTopic(prompt)}>{prompt}</button>
            ))}
          </div>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>

      <div className="toolbar">
        <div className="chips" aria-label="Filter">
          {FILTERS.map((item) => (
            <button key={item.id} className={filter === item.id ? "chip is-on" : "chip"} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
        <input className="field" style={{ maxWidth: 240 }} type="search" placeholder="Search" aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {items === null ? (
        <p className="fine" style={{ marginTop: 24 }}>Loading projects</p>
      ) : shown.length === 0 ? (
        <div className="empty">{items.length ? "No projects match this view." : "No projects yet. Start with a topic above."}</div>
      ) : (
        <section className="cards">
          {shown.map((item) => (
            <article key={item.id} className="surface card">
              <Link href={`/studio/p/${item.id}`} className="card-poster" aria-label={`Open ${item.title}`}>
                {item.poster ? <img src={item.poster} alt="" /> : <span>{item.mode === "code_lab" ? "Code Lab" : "Explainer"}</span>}
              </Link>
              <div className="card-top">
                <Link href={`/studio/p/${item.id}`}>{item.title}</Link>
                <span className="badge" data-tone={item.badge}>{item.badge}</span>
              </div>
              <div className="card-foot">
                <span className="fine mono">{item.format.replace("x", ":")}{item.targetMs ? ` · ${Math.round(item.targetMs / 1000)}s` : ""}{item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleDateString()}` : ""}</span>
                <button className="btn quiet sm" type="button" onClick={() => void remove(item)} aria-label={`Delete ${item.title}`}>Delete</button>
              </div>
            </article>
          ))}
        </section>
      )}

      <div className="toolbar">
        <button className="btn quiet sm" type="button" aria-expanded={showDeleted} onClick={() => { const next = !showDeleted; setShowDeleted(next); if (next) void loadDeleted(); }}>
          {showDeleted ? "Hide recently deleted" : "Recently deleted"}
        </button>
      </div>
      {showDeleted ? (
        <section className="surface panel" aria-label="Recently deleted">
          <p className="fine">Deleted projects stay here for 7 days, then they and their films are erased. Restoring does not bring back old share links.</p>
          {deleted.length === 0 ? <p className="fine">Nothing deleted in the last 7 days.</p> : deleted.map((item) => (
            <div key={item.id} className="list-row">
              <span>{item.title}</span>
              <span className="row-actions">
                <span className="fine mono">{item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : ""}</span>
                <button className="btn ghost sm" type="button" onClick={() => void restore(item)}>Restore</button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
