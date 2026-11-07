"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StudioBar } from "../../../../components/studio/studio-bar";
import { BriefPanel } from "../../../../components/studio/panels";
import { api, newKey, usePending } from "../../../../components/ui/client";
import { Button, Empty, Notice, Panel, timeAgo } from "../../../../components/ui/kit";

type Bible = { world: string; tone: string; rules: string[]; continuity: string; locations: string[] };
type Series = { id: string; title: string; logline: string; mode: string; style: string; revision: number; version: number; bible: Bible; castIds: string[] };
type Cast = { id: string; name: string; sheetUrl?: string | null; look?: { skin: string; top: string; hair: string } };
type Episode = { id: string; title: string; episodeNumber: number; badge: string; recap: string; seriesVersion: number | null; poster: string | null };

export default function SeriesDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { run, busy } = usePending();
  const [series, setSeries] = useState<Series | null>(null);
  const [form, setForm] = useState({ title: "", logline: "", style: "storybook", world: "", tone: "", rules: "", continuity: "", locations: "", castIds: [] as string[] });
  const [library, setLibrary] = useState<Cast[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [versions, setVersions] = useState<{ version: number; createdAt: string }[]>([]);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [research, setResearch] = useState(false);

  const adopt = (s: Series) => {
    setSeries(s);
    setForm({ title: s.title, logline: s.logline, style: s.style, world: s.bible.world, tone: s.bible.tone, rules: s.bible.rules.join("\n"), continuity: s.bible.continuity ?? "", locations: (s.bible.locations ?? []).join(", "), castIds: s.castIds });
  };

  const load = useCallback(async () => {
    const res = await api<{ series: Series; episodes: Episode[]; versions: { version: number; createdAt: string }[] }>(`/api/series/${params.id}`);
    if (!res.ok) { setError(res.error); return; }
    adopt(res.data.series);
    setEpisodes(res.data.episodes);
    setVersions(res.data.versions);
  }, [params.id]);

  useEffect(() => {
    void load();
    void api<{ items: Cast[] }>("/api/characters").then((res) => { if (res.ok) setLibrary(res.data.items); });
    void api<{ research: { available: boolean } }>("/api/catalog").then((res) => { if (res.ok) setResearch(res.data.research.available); });
  }, [load]);

  if (!series) return <main className="app"><StudioBar />{error ? <Notice tone="bad">{error} <Link href="/studio/series">Back to series</Link></Notice> : <div className="surface panel skeleton tall" />}</main>;

  const body = () => ({
    expectedRevision: series.revision, title: form.title.trim(), logline: form.logline.trim(), style: form.style, world: form.world.trim(), tone: form.tone.trim(),
    rules: form.rules.split("\n").map((r) => r.trim()).filter(Boolean).slice(0, 12), continuity: form.continuity.trim(),
    locations: form.locations.split(",").map((l) => l.trim()).filter(Boolean).slice(0, 12), castIds: form.castIds,
  });
  const dirty = JSON.stringify({ ...body(), expectedRevision: 0 }) !== JSON.stringify({ expectedRevision: 0, title: series.title, logline: series.logline, style: series.style, world: series.bible.world, tone: series.bible.tone, rules: series.bible.rules, continuity: series.bible.continuity ?? "", locations: series.bible.locations ?? [], castIds: series.castIds });

  const saveBible = async () => {
    const res = await api<{ series: Series }>(`/api/series/${series.id}`, { method: "PATCH", body: body() });
    if (!res.ok) { setError(res.reason === "REVISION_CONFLICT" ? "This series changed in another tab. Reload it." : res.error); return null; }
    adopt(res.data.series);
    return res.data.series;
  };

  const save = () => run("save", async () => { setError(""); if (await saveBible()) setNote("Bible saved. Approve a version so new episodes use it."); });

  // Approving always freezes what you see: unsaved edits are saved first.
  const approve = () => run("approve", async () => {
    setError("");
    const current = dirty ? await saveBible() : series;
    if (!current) return;
    const res = await api<{ version: number }>(`/api/series/${series.id}/versions`, { body: { expectedRevision: current.revision } });
    if (!res.ok) { setError(res.error); return; }
    setNote(`Version ${res.data.version} approved. New episodes use it; earlier episodes keep theirs.`);
    await load();
  });

  const episode = () => run("episode", async () => {
    setError("");
    const res = await api<{ project: { id: string } }>(`/api/series/${series.id}/episodes`, { body: { topic }, idempotencyKey: newKey() });
    if (!res.ok) { setError(res.error); return; }
    router.push(`/studio/p/${res.data.project.id}`);
  });

  const remove = () => run("delete", async () => {
    if (!confirm(`Delete the series ${series.title}? Its episodes stay as ordinary projects.`)) return;
    const res = await api(`/api/series/${series.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    router.push("/studio/series");
  });

  return (
    <main className="app" data-mode={series.mode}>
      <StudioBar />
      <div className="page-head">
        <div><p className="kicker">Series · {series.version ? `approved v${series.version}` : "not approved yet"}{dirty ? " · unsaved edits" : ""}</p><h1>{series.title}</h1></div>
        <div className="row-actions">
          <Button tone="ghost" pending={busy("save")} disabled={!dirty} onClick={() => void save()}>Save</Button>
          <Button tone="accent" pending={busy("approve")} onClick={() => void approve()}>{dirty ? "Save and approve version" : "Approve version"}</Button>
        </div>
      </div>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      <div className="split align-start">
        <div className="ws-main">
          <Panel kicker="Bible" title="World, tone and rules">
            <div className="split">
              <label className="stack-label">Title<input className="field" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label className="stack-label">Drawing style<select className="field" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}><option value="storybook">Storybook</option><option value="cartoon">Cartoon</option><option value="flat">Flat</option><option value="clay">Clay</option></select></label>
            </div>
            <label className="stack-label">Logline<input className="field" value={form.logline} maxLength={400} onChange={(e) => setForm({ ...form, logline: e.target.value })} /></label>
            <label className="stack-label">World<textarea className="field" value={form.world} maxLength={2000} onChange={(e) => setForm({ ...form, world: e.target.value })} placeholder="A small hill town with a busy market and a river" /></label>
            <label className="stack-label">Tone<input className="field" value={form.tone} maxLength={400} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="Warm, funny, never scary" /></label>
            <label className="stack-label">Rules (one per line)<textarea className="field small" value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="Tikku always asks one question\nEvery episode ends at home" /></label>
            <label className="stack-label">Continuity notes<textarea className="field small" value={form.continuity} maxLength={2000} onChange={(e) => setForm({ ...form, continuity: e.target.value })} placeholder="Tikku broke his kite in episode 2; it is mended now" /></label>
            <label className="stack-label">Recurring places (comma separated)<input className="field" value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} placeholder="market, school, riverbank" /></label>
          </Panel>
          <Panel kicker="Cast" title="Who is in every episode" actions={<Link className="btn ghost sm" href="/studio/library?tab=characters">Make a character</Link>}>
            {library.length ? (
              <div className="cast-pick">
                {library.map((c) => (
                  <label key={c.id}>
                    <input type="checkbox" checked={form.castIds.includes(c.id)} onChange={(e) => setForm({ ...form, castIds: e.target.checked ? [...form.castIds, c.id].slice(0, 8) : form.castIds.filter((id) => id !== c.id) })} />
                    {c.sheetUrl ? <img src={c.sheetUrl} alt="" /> : <span className="ph swatch" style={c.look ? { background: `linear-gradient(${c.look.hair} 0 30%, ${c.look.skin} 30% 55%, ${c.look.top} 55%)` } : undefined} />}
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            ) : <p className="fine">No characters yet.</p>}
          </Panel>
          <BriefPanel scope="series" id={series.id} suggested={series.logline || series.title} researchAvailable={research} />
        </div>
        <div className="ws-main">
          <Panel kicker="Episodes" title="In order">
            <div className="composer-row">
              <input className="field" value={topic} maxLength={2000} onChange={(e) => setTopic(e.target.value)} placeholder="What happens in the next episode?" aria-label="Next episode" />
              <Button tone="accent" pending={busy("episode")} disabled={topic.trim().length < 3 || !series.version} onClick={() => void episode()}>New episode</Button>
            </div>
            {!series.version ? <p className="fine">Approve a version first; each episode is made with an approved bible and cast.</p> : null}
            {episodes.length ? (
              <div className="episodes">
                {episodes.map((ep) => (
                  <Link key={ep.id} href={`/studio/p/${ep.id}`} className="episode">
                    <b>{ep.episodeNumber}</b>
                    <span><strong>{ep.title}</strong><span className="fine">{ep.recap || "No recap yet"}{ep.seriesVersion ? ` · made with v${ep.seriesVersion}` : ""}</span></span>
                    <span className="badge" data-tone={ep.badge}>{ep.badge}</span>
                  </Link>
                ))}
              </div>
            ) : <Empty title="No episodes yet" />}
          </Panel>
          <Panel kicker="History" title="Approved versions">
            {versions.length ? versions.map((v) => <div key={v.version} className="list-row"><span>Version {v.version}</span><span className="fine">{timeAgo(v.createdAt)}</span></div>) : <p className="fine">Nothing approved yet.</p>}
            <Button tone="danger" size="sm" pending={busy("delete")} onClick={() => void remove()}>Delete series</Button>
          </Panel>
        </div>
      </div>
    </main>
  );
}
