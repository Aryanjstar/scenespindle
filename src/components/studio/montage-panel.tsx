"use client";

import { useEffect, useState } from "react";
import { api, newKey, usePending } from "../ui/client";
import { Button, Notice, Panel } from "../ui/kit";
import { AssetPicker } from "./asset-picker";
import type { Catalog, ProjectView } from "./panels";

type SavedStyle = { id: string; name: string; state: string; notes: string; measured: { avgShot: number } | null };
type Chapter = { time: string; label: string };

const FONTS = [
  ["", "Style default"], ["playfair", "Playfair Display"], ["instrument-serif", "Instrument Serif"], ["pinyon", "Pinyon Script"],
  ["great-vibes", "Great Vibes"], ["caveat", "Caveat"], ["inter-black", "Inter Black"], ["bricolage", "Bricolage"],
] as const;

/**
 * Montage: your clips cut on the beat of your music, in a registered style. Every text field is
 * shown on screen as written (escaped); your edit notes are turned into settings, never run.
 */
export function MontagePanel({ project, catalog, disabled, onQueued }: { project: ProjectView; catalog: Catalog | null; disabled: boolean; onQueued: (jobId: string) => void }) {
  const { run, busy } = usePending();
  const m = (project.montage ?? {}) as Record<string, unknown>;
  const [clips, setClips] = useState<string[]>((m.assetIds as string[]) ?? []);
  const [music, setMusic] = useState<string[]>(m.musicAssetId ? [String(m.musicAssetId)] : []);
  const [seconds, setSeconds] = useState<number>(Number(m.seconds ?? 16));
  const [styleId, setStyleId] = useState<string>(String(m.styleId ?? "vlog-day@1"));
  const [savedStyleId, setSavedStyleId] = useState<string>(String(m.savedStyleId ?? ""));
  const [title, setTitle] = useState(String(m.title ?? ""));
  const [kicker, setKicker] = useState(String(m.kicker ?? ""));
  const [subtitle, setSubtitle] = useState(String(m.subtitle ?? ""));
  const [outro, setOutro] = useState(String(m.outro ?? ""));
  const [outroSub, setOutroSub] = useState(String(m.outroSub ?? ""));
  const [chapters, setChapters] = useState<Chapter[]>((m.chapters as Chapter[]) ?? []);
  const [accent, setAccent] = useState(String(m.accent ?? ""));
  const [font, setFont] = useState(String(m.displayFont ?? ""));
  const [pacing, setPacing] = useState(String(m.pacing ?? ""));
  const [instructions, setInstructions] = useState(String(m.instructions ?? ""));
  const [styles, setStyles] = useState<SavedStyle[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { void api<{ items: SavedStyle[] }>("/api/styles").then((res) => { if (res.ok) setStyles(res.data.items.filter((s) => s.state === "ready")); }); }, []);

  const overlay = styleId !== "beat-cut@1" || Boolean(savedStyleId);
  const setChapter = (i: number, patch: Partial<Chapter>) => setChapters((list) => list.map((c, k) => (k === i ? { ...c, ...patch } : c)));

  const render = () => run("render", async () => {
    setError("");
    const settings = {
      styleId, savedStyleId: savedStyleId || null, title, kicker, subtitle, outro, outroSub,
      chapters: chapters.filter((c) => c.label.trim()).map((c) => ({ time: c.time.trim(), label: c.label.trim() })),
      ...(accent ? { accent } : {}), ...(font ? { displayFont: font } : {}), ...(pacing ? { pacing } : {}), instructions,
    };
    const res = await api<{ jobId: string }>(`/api/projects/${project.id}/montage`, { body: { assetIds: clips, musicAssetId: music[0] ?? null, seconds, settings }, idempotencyKey: newKey() });
    if (!res.ok) { setError(res.error); return; }
    onQueued(res.data.jobId);
  });

  return (
    <>
      <Panel kicker="Montage" title="Your clips, cut on the beat">
        <AssetPicker kinds={["video", "image"]} accept="visual" multiple value={clips} onChange={(ids) => setClips(ids.slice(0, 24))} label={`Photos and clips, in order (${clips.length} of 24)`} uploadLabel="Upload clips" />
        <AssetPicker kinds={["audio"]} value={music} onChange={(ids) => setMusic(ids)} label="Music" uploadLabel="Upload music" />
        {music.length ? <Button tone="quiet" size="sm" onClick={() => setMusic([])}>No music</Button> : null}
        <label className="stack-label">Length: {seconds} seconds
          <input type="range" min={5} max={90} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Length in seconds" />
        </label>
        <p className="fine">The most lively part of each clip is picked for you. Originals are never changed. Check you have the rights to the clips and music before sharing.</p>
      </Panel>

      <Panel kicker="Style" title="How it looks and sounds">
        <div className="style-grid" role="radiogroup" aria-label="Montage style">
          {(catalog?.montageStyles ?? []).map((style) => (
            <button key={style.id} type="button" role="radio" aria-checked={styleId === style.id && !savedStyleId} className={`style-card ${styleId === style.id && !savedStyleId ? "is-on" : ""}`} data-style={style.id} onClick={() => { setStyleId(style.id); setSavedStyleId(""); }}>
              <strong>{style.label}</strong><span>{style.note}</span>
            </button>
          ))}
          {styles.map((style) => (
            <button key={style.id} type="button" role="radio" aria-checked={savedStyleId === style.id} className={`style-card learned ${savedStyleId === style.id ? "is-on" : ""}`} onClick={() => setSavedStyleId(style.id)}>
              <strong>{style.name}</strong><span>{style.notes || "Learned from your references."}{style.measured ? ` Average shot ${style.measured.avgShot}s.` : ""}</span>
            </button>
          ))}
        </div>
        <p className="fine">Learn a style from reels you like in <a href="/studio/library?tab=styles">Library, Styles</a>.</p>
        {overlay ? (
          <>
            <div className="split">
              <label className="stack-label">On-screen title<input aria-label="On-screen title" className="field" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="day in my life" />
              </label>
              <label className="stack-label">Handwritten subtitle<input aria-label="Handwritten subtitle" className="field" value={subtitle} maxLength={60} onChange={(e) => setSubtitle(e.target.value)} placeholder="study and classes" />
              </label>
            </div>
            <div className="split">
              <label className="stack-label">Small line above the title<input aria-label="Small line above the title" className="field" value={kicker} maxLength={40} onChange={(e) => setKicker(e.target.value)} placeholder="(exam season)" />
              </label>
              <label className="stack-label">Ending<input aria-label="Ending" className="field" value={outro} maxLength={40} onChange={(e) => setOutro(e.target.value)} placeholder="Good Night" />
              </label>
            </div>
            <label className="stack-label">Line under the ending<input aria-label="Line under the ending" className="field" value={outroSub} maxLength={40} onChange={(e) => setOutroSub(e.target.value)} placeholder="[thanks for watching]" />
            </label>
            <div className="stack-label">
              <span className="stack-label-text">Chapters (time and activity, shown as the day moves on)</span>
              {chapters.map((c, i) => (
                <div key={i} className="chapter-row">
                  <input className="field mono" value={c.time} maxLength={16} onChange={(e) => setChapter(i, { time: e.target.value })} placeholder="7:30 AM" aria-label={`Chapter ${i + 1} time`} />
                  <input className="field" value={c.label} maxLength={28} onChange={(e) => setChapter(i, { label: e.target.value })} placeholder="wake up" aria-label={`Chapter ${i + 1} activity`} />
                  <Button tone="quiet" size="sm" aria-label={`Remove chapter ${i + 1}`} onClick={() => setChapters((list) => list.filter((_, k) => k !== i))}>Remove</Button>
                </div>
              ))}
              {chapters.length < 8 ? <Button tone="ghost" size="sm" onClick={() => setChapters((list) => [...list, { time: "", label: "" }])}>Add a chapter</Button> : null}
            </div>
            <div className="grid-3">
              <label className="stack-label">Title font<select aria-label="Title font" className="field" value={font} onChange={(e) => setFont(e.target.value)}>{FONTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
              </label>
              <label className="stack-label">Accent colour
                <span className="row-actions"><input type="color" value={accent || "#ff4f58"} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour" />{accent ? <Button tone="quiet" size="sm" onClick={() => setAccent("")}>Default</Button> : null}</span>
              </label>
              <label className="stack-label">Pacing<select aria-label="Pacing" className="field" value={pacing} onChange={(e) => setPacing(e.target.value)}>
                  <option value="">Style default</option><option value="two-beats">Calm, every two beats</option><option value="beat">Every beat</option><option value="half-beat">Fast, every half beat</option>
                </select>
              </label>
            </div>
          </>
        ) : null}
        <label className="stack-label">How should it be edited? (your words win over the style)<textarea aria-label="How should it be edited? (your words win over the style)" className="field" value={instructions} maxLength={1200} onChange={(e) => setInstructions(e.target.value)} placeholder="Soft and cozy, slow first half, chapters for morning, class, cafe and night, end on Good Night in script." />
        </label>
      </Panel>

      <div className="row-actions sticky-actions">
        <Button tone="accent" size="lg" pending={busy("render")} disabled={disabled || clips.length === 0} onClick={() => void render()}>Render montage</Button>
        {clips.length === 0 ? <span className="fine">Pick at least one clip or photo.</span> : null}
      </div>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </>
  );
}
