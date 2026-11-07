import { readFileSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";

/**
 * Editable exports. OTIO is written directly as OpenTimelineIO JSON (no Python needed): the film
 * is a baked media reference, scenes or montage cuts are clips on it, narration lines are markers.
 * Procedural effects are baked into film.mp4; the manifest says so.
 */
type Rational = { OTIO_SCHEMA: "RationalTime.1"; rate: number; value: number };
const RATE = 30;
const rt = (ms: number): Rational => ({ OTIO_SCHEMA: "RationalTime.1", rate: RATE, value: Math.round((ms / 1000) * RATE) });
const range = (startMs: number, durationMs: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(startMs), duration: rt(durationMs) });

export type FilmEdl = { durationMs: number; scenes?: { id: string; startMs: number; durationMs: number }[]; lines?: { sceneId: string; lineId: string; text: string; startMs: number; durationMs: number }[]; cuts?: number[]; clips?: number[] };

export function toOtio(name: string, edl: FilmEdl, media = "film.mp4"): Record<string, unknown> {
  const available = range(0, edl.durationMs);
  const ref = { OTIO_SCHEMA: "ExternalReference.1", target_url: media, available_range: available, metadata: {} };
  const segments = edl.scenes?.length
    ? edl.scenes.map((scene) => ({ name: scene.id, startMs: scene.startMs, durationMs: scene.durationMs, meta: {} as Record<string, unknown> }))
    : (edl.cuts ?? [0, edl.durationMs / 1000]).slice(0, -1).map((cut, i, all) => ({ name: `shot ${i + 1}`, startMs: Math.round(cut * 1000), durationMs: Math.round(((edl.cuts ?? [])[i + 1] ?? all[i] + 1) * 1000 - cut * 1000), meta: { sourceClipIndex: edl.clips?.[i] ?? null } }));
  const clip = (seg: { name: string; startMs: number; durationMs: number; meta: Record<string, unknown> }) => ({
    OTIO_SCHEMA: "Clip.2", name: seg.name, source_range: range(seg.startMs, seg.durationMs),
    media_references: { DEFAULT_MEDIA: ref }, active_media_reference_key: "DEFAULT_MEDIA",
    effects: [], markers: [], enabled: true, metadata: { scenespindle: seg.meta },
  });
  const markers = (edl.lines ?? []).map((line) => ({ OTIO_SCHEMA: "Marker.2", name: line.text.slice(0, 120), color: "YELLOW", marked_range: range(line.startMs, Math.max(1, line.durationMs)), comment: "", metadata: { scenespindle: { sceneId: line.sceneId, lineId: line.lineId } } }));
  return {
    OTIO_SCHEMA: "Timeline.1", name, global_start_time: rt(0), metadata: { scenespindle: { note: "Effects and text are baked into the media; clips are ranges of it." } },
    tracks: {
      OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {},
      children: [
        { OTIO_SCHEMA: "Track.1", name: "Picture", kind: "Video", source_range: null, effects: [], markers, enabled: true, metadata: {}, children: segments.map(clip) },
        { OTIO_SCHEMA: "Track.1", name: "Sound", kind: "Audio", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [clip({ name: "mix", startMs: 0, durationMs: edl.durationMs, meta: {} })] },
      ],
    },
  };
}

/** Minimal ZIP writer (stored, no compression; media is already compressed). */
export function writeZip(out: string, entries: { name: string; file?: string; data?: Buffer | string }[]): void {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = entry.file ? readFileSync(entry.file) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
    const name = Buffer.from(entry.name.replaceAll("\\", "/").replace(/^\/+/, ""));
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(0, 10);
    head.writeUInt32LE(0, 12); head.writeUInt32LE(crc, 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(out, Buffer.concat([...parts, ...central, end]));
}
