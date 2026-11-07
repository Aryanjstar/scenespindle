"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StudioBar } from "../../../components/studio/studio-bar";
import { AssetPicker } from "../../../components/studio/asset-picker";
import { api, uploadFile, usePending, waitForJob } from "../../../components/ui/client";
import { Button, Empty, Notice, Panel, timeAgo } from "../../../components/ui/kit";

type Tab = "files" | "characters" | "styles";

export default function LibraryPage() {
  return <Suspense fallback={<main className="app"><StudioBar /></main>}><Library /></Suspense>;
}

function Library() {
  const search = useSearchParams();
  const router = useRouter();
  const tab = (["files", "characters", "styles"].includes(search.get("tab") ?? "") ? search.get("tab") : "files") as Tab;
  return (
    <main className="app">
      <StudioBar />
      <div className="page-head">
        <div><p className="kicker">Library</p><h1>Your things</h1></div>
        <div className="tabs" role="tablist" aria-label="Library">
          {([["files", "Files"], ["characters", "Characters"], ["styles", "Styles"]] as const).map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => router.replace(`/studio/library?tab=${id}`)}>{label}</button>
          ))}
        </div>
      </div>
      {tab === "files" ? <Files /> : tab === "characters" ? <Characters /> : <Styles />}
    </main>
  );
}

/* ---------------------------------------------------------------- files */

type FileItem = { id: string; name: string; kind: string; source: string; bytes: number | null; rights: string; createdAt: string };

function Files() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [kind, setKind] = useState("all");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [rights, setRights] = useState<"own" | "licensed" | "unknown">("own");

  const load = useCallback(async () => {
    const res = await api<{ items: FileItem[] }>("/api/library/assets");
    if (!res.ok) { setError(res.error); setItems([]); return; }
    setItems(res.data.items);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null, mask = false) {
    if (!files?.length) return;
    setError("");
    for (const file of Array.from(files)) {
      const res = await uploadFile(file, { rights, kind: mask ? "mask" : "auto", onProgress: (f) => setProgress(`${file.name}: ${Math.round(f * 100)}%`) });
      if (!res.ok) setError(`${file.name}: ${res.error}`);
    }
    setProgress("");
    await load();
  }

  const remove = (item: FileItem) => run(`del-${item.id}`, async () => {
    if (!confirm(`Delete ${item.name}? It is erased after 7 days.`)) return;
    const res = await api(`/api/library/assets/${item.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });

  const shown = (items ?? []).filter((i) => kind === "all" || i.kind === kind);
  return (
    <>
      <Panel kicker="Upload" title="Add photos, clips, music and masks">
        <p className="fine">PNG, JPEG, WebP, MP3, WAV or MP4, up to 500 MB. Large files upload in parts and resume if the network drops. The type is checked from the file itself.</p>
        <div className="row-actions">
          <select className="field field-sm" value={rights} onChange={(e) => setRights(e.target.value as typeof rights)} aria-label="Rights">
            <option value="own">I made it</option><option value="licensed">I have a licence</option><option value="unknown">Not sure</option>
          </select>
          <label className="btn upload-btn">Upload files<input type="file" multiple accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,video/mp4,.mp3,.wav" onChange={(e) => { const f = e.currentTarget.files; void upload(f); e.currentTarget.value = ""; }} /></label>
          <label className="btn ghost upload-btn" title="A black-and-white PNG that marks a subject, for text behind a person">Upload a cutout mask<input type="file" accept="image/png" onChange={(e) => { const f = e.currentTarget.files; void upload(f, true); e.currentTarget.value = ""; }} /></label>
          {progress ? <span className="fine" role="status">{progress}</span> : null}
        </div>
      </Panel>
      <div className="toolbar">
        <div className="chips" aria-label="Kind">
          {[["all", "All"], ["video", "Clips"], ["image", "Images"], ["audio", "Audio"], ["mask", "Masks"]].map(([id, label]) => <button key={id} type="button" className={kind === id ? "chip is-on" : "chip"} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}
        </div>
      </div>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      {items === null ? <div className="surface panel skeleton" /> : !shown.length ? <Empty title="Nothing here yet"><p className="fine">Upload something above.</p></Empty> : (
        <section className="gallery">
          {shown.map((item) => (
            <article key={item.id} className="surface char-card">
              <div className="portrait file-thumb">
                {item.kind === "image" || item.kind === "mask" ? <img src={`/api/assets/${item.id}/file`} alt="" loading="lazy" /> : item.kind === "video" ? <video src={`/api/assets/${item.id}/file`} muted playsInline preload="metadata" /> : <span>♪</span>}
              </div>
              <strong className="pick-name">{item.name}</strong>
              <span className="fine">{item.kind} · {item.source === "generated" ? "made here" : item.rights === "licensed" ? "licensed" : item.rights === "unknown" ? "rights unknown" : "yours"}{item.bytes ? ` · ${(item.bytes / 1_048_576).toFixed(1)} MB` : ""} · {timeAgo(item.createdAt)}</span>
              <div className="row-actions">
                <a className="btn ghost sm" href={`/api/assets/${item.id}/file?download=1`}>Download</a>
                <Button tone="quiet" size="sm" pending={busy(`del-${item.id}`)} onClick={() => void remove(item)}>Delete</Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------- characters */

type Look = { skin: string; hair: string; hairStyle: string; top: string; bottom: string; outfit: string; build: string; accessory: string };
type Character = { id: string; name: string; description: string; style: string; state: string; rights: string; rightsNote: string; sheetUrl: string | null; referenceAssetId: string | null; look: Look; version: number; versions: { version: number; sheetUrl: string }[] };
const SKINS = ["#f6d7b8", "#eac3a0", "#d9a477", "#c18a5c", "#9c6b45", "#6f4a30"];
const DEFAULT_LOOK: Look = { skin: "#d9a477", hair: "#1a1410", hairStyle: "short", top: "#2a9d8f", bottom: "#33415c", outfit: "pants", build: "adult", accessory: "none" };

function LookEditor({ look, onChange }: { look: Look; onChange: (l: Look) => void }) {
  const sel = (key: keyof Look, options: string[]) => (
    <label className="stack-label">{key === "hairStyle" ? "Hair" : key[0].toUpperCase() + key.slice(1)}
      <select className="field field-sm" value={look[key]} onChange={(e) => onChange({ ...look, [key]: e.target.value })}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    </label>
  );
  return (
    <div className="look-editor">
      <div className="stack-label"><span className="stack-label-text">Skin</span><div className="row-actions">{SKINS.map((s) => <button key={s} type="button" aria-label={`Skin ${s}`} aria-pressed={look.skin === s} className="swatch-btn" style={{ background: s, outline: look.skin === s ? "3px solid var(--ink)" : "none" }} onClick={() => onChange({ ...look, skin: s })} />)}</div></div>
      <label className="stack-label">Hair colour<input type="color" value={look.hair} onChange={(e) => onChange({ ...look, hair: e.target.value })} /></label>
      <label className="stack-label">Top<input type="color" value={look.top} onChange={(e) => onChange({ ...look, top: e.target.value })} /></label>
      <label className="stack-label">Bottom<input type="color" value={look.bottom} onChange={(e) => onChange({ ...look, bottom: e.target.value })} /></label>
      {sel("hairStyle", ["short", "long", "ponytail", "bun", "curly", "bald"])}
      {sel("outfit", ["pants", "dress", "kurta", "saree"])}
      {sel("build", ["child", "adult", "elder"])}
      {sel("accessory", ["none", "glasses", "cap", "scarf", "bindi"])}
      <div className="look-preview" aria-hidden="true" style={{ background: `linear-gradient(${look.hair} 0 18%, ${look.skin} 18% 40%, ${look.top} 40% 72%, ${look.outfit === "pants" || look.outfit === "kurta" ? look.bottom : look.top} 72%)` }} />
    </div>
  );
}

function Characters() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<Character[] | null>(null);
  const [images, setImages] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ name: "", description: "", style: "storybook", rights: "own", rightsNote: "", reference: [] as string[], look: DEFAULT_LOOK });
  const [editing, setEditing] = useState<string>("");

  const load = useCallback(async () => {
    const res = await api<{ items: Character[]; imagesAvailable: boolean }>("/api/characters");
    if (!res.ok) { setError(res.error); setItems([]); return; }
    setItems(res.data.items);
    setImages(res.data.imagesAvailable);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = () => run("create", async () => {
    setError("");
    const res = await api<{ character: Character; jobId?: string }>("/api/characters", { body: { name: form.name, description: form.description, style: form.style, rights: form.rights, rightsNote: form.rightsNote, referenceAssetId: form.reference[0], draw: images && Boolean(form.reference[0] || form.description), look: form.look } });
    if (!res.ok) { setError(res.error); return; }
    setForm({ name: "", description: "", style: "storybook", rights: "own", rightsNote: "", reference: [], look: DEFAULT_LOOK });
    setNote(res.data.jobId ? `${res.data.character.name} added. Drawing the sheet...` : `${res.data.character.name} added.`);
    await load();
    if (res.data.jobId) { const job = await waitForJob(res.data.jobId); setNote(job?.state === "succeeded" ? "Character sheet drawn." : job?.error?.message ?? "The sheet was not drawn."); await load(); }
  });

  const save = (c: Character, patch: Partial<Character> & { referenceAssetId?: string | null }) => run(`save-${c.id}`, async () => {
    const res = await api(`/api/characters/${c.id}`, { method: "PATCH", body: patch });
    if (!res.ok) { setError(res.error); return; }
    setNote(`${c.name} saved.`);
    await load();
  });

  const draw = (c: Character) => run(`draw-${c.id}`, async () => {
    const res = await api<{ jobId: string }>(`/api/characters/${c.id}/draw`, { body: {} });
    if (!res.ok) { setError(res.error); return; }
    setNote(`Drawing ${c.name}...`);
    const job = await waitForJob(res.data.jobId);
    setNote(job?.state === "succeeded" ? `${c.name} redrawn. Old films keep the version they used.` : job?.error?.message ?? "The sheet was not drawn.");
    await load();
  });

  const remove = (c: Character) => run(`del-${c.id}`, async () => {
    if (!confirm(`Remove ${c.name}? Films and approved series keep the version they used.`)) return;
    const res = await api(`/api/characters/${c.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });

  return (
    <>
      <Panel kicker="New character" title="Make an original character">
        <div className="split">
          <label className="stack-label">Name<input className="field" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Asha" /></label>
          <label className="stack-label">Drawing style<select className="field" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}><option value="storybook">Storybook</option><option value="cartoon">Cartoon</option><option value="flat">Flat</option><option value="clay">Clay</option></select></label>
        </div>
        <label className="stack-label">Who they are<textarea className="field small" value={form.description} maxLength={280} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A grandmother who tells stories, silver bun, purple saree" /></label>
        <p className="stack-label-text">How they look on the 3D stage</p>
        <LookEditor look={form.look} onChange={(look) => setForm({ ...form, look })} />
        {images ? <AssetPicker kinds={["image"]} value={form.reference} onChange={(ids) => setForm({ ...form, reference: ids })} label="Reference drawing (optional): the sheet is redrawn from it" uploadLabel="Upload drawing" /> : <p className="fine">Character sheets need the image service. The 3D stage uses the look above either way.</p>}
        <div className="split">
          <label className="stack-label">Rights<select className="field" value={form.rights} onChange={(e) => setForm({ ...form, rights: e.target.value })}><option value="own">My own creation</option><option value="licensed">Licensed to me</option><option value="original-generated">Original, made here</option></select></label>
          <label className="stack-label">Rights note<input className="field" value={form.rightsNote} maxLength={280} onChange={(e) => setForm({ ...form, rightsNote: e.target.value })} placeholder="Licence or source, if any" /></label>
        </div>
        <Button tone="accent" pending={busy("create")} disabled={form.name.trim().length < 2} onClick={() => void create()}>Add character</Button>
        <p className="fine">Original characters only. Famous characters and real people are refused.</p>
      </Panel>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      {items === null ? <div className="surface panel skeleton" /> : !items.length ? <Empty title="No characters yet"><p className="fine">Stories without a cast use two default performers.</p></Empty> : (
        <section className="gallery">
          {items.map((c) => (
            <article key={c.id} className="surface char-card">
              <div className="portrait">{c.sheetUrl ? <img src={c.sheetUrl} alt={`${c.name} character sheet`} /> : <div className="look-preview big" style={{ background: `linear-gradient(${c.look.hair} 0 18%, ${c.look.skin} 18% 40%, ${c.look.top} 40% 72%, ${c.look.bottom} 72%)` }} />}</div>
              <strong>{c.name}</strong>
              <span className="fine">{c.description || "No description"} · {c.state}{c.version ? ` · sheet v${c.version}` : ""} · {c.rights}</span>
              {editing === c.id ? (
                <CharacterEdit c={c} images={images} pending={busy(`save-${c.id}`)} onSave={(patch) => void save(c, patch).then(() => setEditing(""))} onCancel={() => setEditing("")} />
              ) : (
                <div className="row-actions">
                  <Button tone="ghost" size="sm" onClick={() => setEditing(c.id)}>Edit</Button>
                  {images ? <Button tone="ghost" size="sm" pending={busy(`draw-${c.id}`) || c.state === "drawing"} onClick={() => void draw(c)}>{c.sheetUrl ? "Redraw sheet" : "Draw sheet"}</Button> : null}
                  <Button tone="quiet" size="sm" pending={busy(`del-${c.id}`)} onClick={() => void remove(c)}>Remove</Button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function CharacterEdit({ c, images, pending, onSave, onCancel }: { c: Character; images: boolean; pending: boolean; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void }) {
  const [description, setDescription] = useState(c.description);
  const [look, setLook] = useState<Look>(c.look);
  const [rights, setRights] = useState(c.rights);
  const [rightsNote, setRightsNote] = useState(c.rightsNote);
  const [reference, setReference] = useState<string[]>(c.referenceAssetId ? [c.referenceAssetId] : []);
  return (
    <div className="stack-label">
      <textarea className="field small" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
      <LookEditor look={look} onChange={setLook} />
      {images ? <AssetPicker kinds={["image"]} value={reference} onChange={setReference} label="Reference drawing" /> : null}
      <select className="field field-sm" value={rights} onChange={(e) => setRights(e.target.value)} aria-label="Rights"><option value="own">My own creation</option><option value="licensed">Licensed to me</option><option value="original-generated">Original, made here</option></select>
      <input className="field" value={rightsNote} maxLength={280} onChange={(e) => setRightsNote(e.target.value)} aria-label="Rights note" placeholder="Rights note" />
      <div className="row-actions">
        <Button size="sm" pending={pending} onClick={() => onSave({ description, look, rights, rightsNote, referenceAssetId: reference[0] ?? null })}>Save</Button>
        <Button tone="quiet" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- styles */

type StyleItem = { id: string; name: string; state: string; notes: string; base: string; measured: { avgShot: number; cutsPerMinute: number; clips: number } | null; fonts: Record<string, string> | null; palette: Record<string, string> | null; grade: string | null; pacing: string | null; createdAt: string };

function Styles() {
  const { run, busy } = usePending();
  const [items, setItems] = useState<StyleItem[] | null>(null);
  const [name, setName] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ items: StyleItem[] }>("/api/styles");
    setItems(res.ok ? res.data.items : []);
    if (!res.ok) setError(res.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const learn = () => run("learn", async () => {
    setError("");
    const res = await api<{ jobId: string }>("/api/styles", { body: { name, assetIds: refs } });
    if (!res.ok) { setError(res.error); return; }
    setNote("Studying your references...");
    await load();
    const job = await waitForJob(res.data.jobId);
    setNote(job?.state === "succeeded" ? "Style learned. Pick it in any Montage." : job?.error?.message ?? "The style could not be learned.");
    setName(""); setRefs([]);
    await load();
  });

  const remove = (s: StyleItem) => run(`del-${s.id}`, async () => {
    if (!confirm(`Delete the style ${s.name}?`)) return;
    const res = await api(`/api/styles/${s.id}`, { method: "DELETE" });
    if (!res.ok) { setError(res.error); return; }
    await load();
  });

  return (
    <>
      <Panel kicker="Style from references" title="Teach the studio a look">
        <p className="fine">Upload one to five reels you like (yours, or ones you have the right to study). The studio measures their cut rhythm and loudness and reads their type, colour and grade into a style you can use in any Montage. Frames are studied, never kept.</p>
        <label className="stack-label">Style name<input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Cozy study vlog" /></label>
        <AssetPicker kinds={["video"]} multiple value={refs} onChange={(ids) => setRefs(ids.slice(0, 5))} label={`Reference reels (${refs.length} of 5)`} uploadLabel="Upload reels" />
        <Button tone="accent" pending={busy("learn")} disabled={!name.trim() || !refs.length} onClick={() => void learn()}>Learn this style</Button>
      </Panel>
      <Notice tone="good" onClose={() => setNote("")}>{note}</Notice>
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
      {items === null ? <div className="surface panel skeleton" /> : !items.length ? <Empty title="No learned styles yet" /> : (
        <section className="gallery">
          {items.map((s) => (
            <article key={s.id} className="surface char-card">
              <div className="portrait style-swatch" style={{ background: s.palette ? `linear-gradient(135deg, ${s.palette.title} 0 40%, ${s.palette.accent} 40% 70%, ${s.palette.night} 70%)` : undefined }}>{s.state === "analyzing" ? <span className="fine">studying...</span> : null}</div>
              <strong>{s.name}</strong>
              <span className="fine">{s.state === "ready" ? `${s.notes} ${s.measured ? `Average shot ${s.measured.avgShot}s, ${s.measured.cutsPerMinute} cuts a minute.` : ""} Grade ${s.grade}.` : s.state}</span>
              <Button tone="quiet" size="sm" pending={busy(`del-${s.id}`)} onClick={() => void remove(s)}>Delete</Button>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
