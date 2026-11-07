"use client";

import { useCallback, useEffect, useState } from "react";
import { api, uploadFile } from "../ui/client";
import { Notice } from "../ui/kit";

export type Asset = { id: string; name: string; kind: string; source?: string; bytes?: number | null };

const ACCEPT: Record<string, string> = { video: "video/mp4", audio: "audio/mpeg,audio/wav,.mp3,.wav", image: "image/png,image/jpeg,image/webp", visual: "video/mp4,image/png,image/jpeg,image/webp", mask: "image/png" };

/**
 * Pick files from your library, or upload new ones right here (large files upload in resumable
 * parts). `kinds` filters what can be chosen; `multiple` allows an ordered selection.
 */
export function AssetPicker({ kinds, value, onChange, multiple = false, label, uploadLabel = "Upload", accept }: {
  kinds: string[]; value: string[]; onChange: (ids: string[], assets: Asset[]) => void; multiple?: boolean; label: string; uploadLabel?: string; accept?: keyof typeof ACCEPT;
}) {
  const [items, setItems] = useState<Asset[] | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [rights, setRights] = useState<"own" | "licensed" | "unknown">("own");

  const kindKey = kinds.join(",");
  const load = useCallback(async () => {
    const res = await api<{ items: Asset[] }>("/api/library/assets");
    if (!res.ok) { setError(res.error); setItems([]); return [] as Asset[]; }
    const wanted = kindKey.split(",");
    const list = res.data.items.filter((item) => wanted.includes(item.kind));
    setItems(list);
    return list;
  }, [kindKey]);

  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const added: string[] = [];
    for (const file of Array.from(files)) {
      setProgress(0);
      const res = await uploadFile(file, { rights, kind: accept === "mask" ? "mask" : "auto", onProgress: setProgress });
      if (!res.ok) { setError(`${file.name}: ${res.error}`); continue; }
      if (!kinds.includes(res.data.asset.kind)) { setError(`${file.name} is a ${res.data.asset.kind} file; this needs ${kinds.join(" or ")}.`); continue; }
      added.push(res.data.asset.id);
    }
    setProgress(null);
    const list = await load();
    if (added.length) {
      const next = multiple ? [...value, ...added] : [added[added.length - 1]];
      onChange(next, list.filter((a) => next.includes(a.id)));
    }
  }

  const toggle = (id: string) => {
    const next = multiple ? (value.includes(id) ? value.filter((v) => v !== id) : [...value, id]) : [id];
    onChange(next, (items ?? []).filter((a) => next.includes(a.id)));
  };

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="stack-label-text">{label}</span>
        <span className="row-actions">
          <select className="field field-sm" value={rights} onChange={(e) => setRights(e.target.value as typeof rights)} aria-label="Rights for new uploads">
            <option value="own">I made it</option>
            <option value="licensed">I have a licence</option>
            <option value="unknown">Not sure</option>
          </select>
          <label className="btn ghost sm upload-btn">
            {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : uploadLabel}
            <input type="file" accept={ACCEPT[accept ?? kinds[0]] ?? undefined} multiple={multiple} disabled={progress !== null} onChange={(e) => { const files = e.currentTarget.files; void upload(files); e.currentTarget.value = ""; }} />
          </label>
        </span>
      </div>
      {items === null ? <p className="fine">Loading your library</p> : items.length === 0 ? <p className="fine">Nothing here yet. Upload a file.</p> : (
        <ul className="picker-list" aria-label={label}>
          {items.map((item) => {
            const order = value.indexOf(item.id);
            return (
              <li key={item.id}>
                <button type="button" className={order >= 0 ? "pick is-on" : "pick"} aria-pressed={order >= 0} onClick={() => toggle(item.id)}>
                  {item.kind === "image" || item.kind === "mask" ? <img src={`/api/assets/${item.id}/file`} alt="" loading="lazy" /> : <span className="pick-kind">{item.kind === "video" ? "▶" : "♪"}</span>}
                  <span className="pick-name">{item.name}</span>
                  {order >= 0 && multiple ? <span className="pick-n">{order + 1}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Notice tone="bad" onClose={() => setError("")}>{error}</Notice>
    </div>
  );
}
