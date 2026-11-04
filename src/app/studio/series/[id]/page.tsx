"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StudioBar } from "../../../../components/studio/studio-bar";

type Series = { id: string; title: string; logline: string; mode: string; style: string; revision: number; version: number; bible: { world: string; tone: string; rules: string[] }; castIds: string[] };
type Cast = { id: string; name: string };
type Episode = { id: string; title: string; episodeNumber: number; badge: string };

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [series, setSeries] = useState<Series | null>(null);
  const [cast, setCast] = useState<Cast[]>([]);
  const [library, setLibrary] = useState<Cast[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [world, setWorld] = useState("");
  const [tone, setTone] = useState("");
  const [rules, setRules] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const response = await fetch(`/api/series/${params.id}`);
    if (response.status === 401) { router.replace("/sign-in"); return; }
    const body = await response.json();
    if (!response.ok) { setError(body?.error?.message || "That series is not here."); return; }
    setSeries(body.series);
    setCast(body.cast || []);
    setEpisodes(body.episodes || []);
    setWorld(body.series.bible.world);
    setTone(body.series.bible.tone);
    setRules((body.series.bible.rules || []).join("\n"));
  }

  useEffect(() => {
    fetch(`/api/series/${params.id}`).then(async (response) => {
      if (response.status === 401) { router.replace("/sign-in"); return; }
      const body = await response.json();
      if (!response.ok) { setError(body?.error?.message || "That series is not here."); return; }
      setSeries(body.series);
      setCast(body.cast || []);
      setEpisodes(body.episodes || []);
      setWorld(body.series.bible.world);
      setTone(body.series.bible.tone);
      setRules((body.series.bible.rules || []).join("\n"));
    });
    fetch("/api/characters").then(async (response) => {
      if (response.ok) setLibrary((await response.json()).items || []);
    });
  }, [params.id, router]);

  if (!series && !error) return <main className="app"><p className="fine">Loading</p></main>;
  if (!series) return <main className="app"><p className="notice bad">{error}</p></main>;

  const selected = new Set(series.castIds);

  return (
    <main className="app">
      <StudioBar />
      <div className="page-head">
        <div>
          <p className="kicker">{series.mode} · version {series.version}</p>
          <h1>{series.title}</h1>
        </div>
        <Link className="btn ghost" href="/studio/series">All series</Link>
      </div>
      {error ? <p className="notice bad" role="alert">{error}</p> : null}
      {status ? <p className="ok" role="status">{status}</p> : null}
      <div className="split">
        <form className="surface panel" onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const response = await fetch(`/api/series/${series.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expectedRevision: series.revision,
              world, tone,
              rules: rules.split("\n").map((line) => line.trim()).filter(Boolean),
              castIds: series.castIds,
            }),
          });
          const body = await response.json();
          if (!response.ok) { setError(body?.error?.message || "Could not save the bible."); return; }
          setStatus("Bible saved.");
          await load();
        }}>
          <h2>Bible</h2>
          <label className="stack-label">World
            <textarea className="field" value={world} onChange={(event) => setWorld(event.target.value)} aria-label="World" />
          </label>
          <label className="stack-label">Tone
            <input className="field" value={tone} onChange={(event) => setTone(event.target.value)} aria-label="Tone" />
          </label>
          <label className="stack-label">Rules, one per line
            <textarea className="field" value={rules} onChange={(event) => setRules(event.target.value)} aria-label="Rules" />
          </label>
          <div className="cast-pick">
            {library.map((member) => (
              <label key={member.id}>
                <input type="checkbox" checked={selected.has(member.id)} aria-label={member.name} onChange={(event) => {
                  const castIds = event.target.checked ? [...series.castIds, member.id] : series.castIds.filter((id) => id !== member.id);
                  setSeries({ ...series, castIds });
                }} />
                <span className="ph">{member.name.slice(0, 1)}</span>
                {member.name}
              </label>
            ))}
          </div>
          <div className="row-actions">
            <button className="btn" type="submit">Save bible</button>
            <button className="btn ghost" type="button" onClick={async () => {
              setError("");
              const response = await fetch(`/api/series/${series.id}/versions`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ expectedRevision: series.revision }),
              });
              const body = await response.json();
              if (!response.ok) { setError(body?.error?.message || "Could not approve this series."); return; }
              setStatus(`Approved as version ${body.version}.`);
              await load();
            }}>Approve version</button>
          </div>
        </form>
        <section className="surface panel" aria-label="Episodes">
          <h2>Episodes</h2>
          <p className="fine">Cast on this series: {cast.map((member) => member.name).join(", ") || "none yet"}.</p>
          <form className="copy-row" onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const response = await fetch(`/api/series/${series.id}/episodes`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ topic }),
            });
            const body = await response.json();
            if (!response.ok) { setError(body?.error?.message || "Could not start that episode."); return; }
            router.push(`/studio/p/${body.project.id}`);
          }}>
            <input className="field" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="What happens" aria-label="Episode topic" required minLength={3} />
            <button className="btn" type="submit">New episode</button>
          </form>
          <div className="episodes">
            {episodes.map((episode) => (
              <Link key={episode.id} className="episode" href={`/studio/p/${episode.id}`}>
                <b>{episode.episodeNumber}</b>
                <span><strong>{episode.title}</strong></span>
                <span className="badge">{episode.badge}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
