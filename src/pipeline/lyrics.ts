import { validatePlan, type Format, type Language, type Plan } from "../contracts/plan";

export type LrcLine = { startMs: number; text: string };

/** Parse LRC lyrics: [mm:ss], [mm:ss.xx] or [mm:ss:xx], several tags per line, metadata tags ignored. */
export function parseLrc(input: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").replaceAll(/[—–]/g, ", ").trim();
    for (const tag of tags) {
      const fraction = tag[3] ? Number(tag[3].padEnd(3, "0").slice(0, 3)) : 0;
      out.push({ startMs: Number(tag[1]) * 60_000 + Number(tag[2]) * 1000 + fraction, text });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** A lyric storyboard from timed lines: no model involved, every time comes from the file. */
export function lyricsPlan(opts: { title: string; lrc: string; songAssetId: string; songMs?: number; language: Language; format: Format }): Plan {
  const all = parseLrc(opts.lrc);
  const sung = all.map((line, index) => ({ ...line, endMs: all[index + 1]?.startMs ?? line.startMs + 4000 })).filter((line) => line.text.length > 0);
  if (sung.length === 0) throw new Error("No timed lyric lines were found. Use LRC lines like [00:12.30] First line.");
  if (sung.length > 120) throw new Error("Lyric videos are limited to 120 lines.");
  const perScene = Math.min(8, Math.max(2, Math.ceil(sung.length / 15)));
  const scenes: Plan["scenes"] = [];
  for (let i = 0; i < sung.length; i += perScene) {
    const group = sung.slice(i, i + perScene);
    const index = scenes.length;
    scenes.push({
      id: `s${index + 1}`,
      purpose: index === 0 ? "hook" : "explain",
      lines: group.map((line, n) => ({ id: `l${n + 1}`, text: line.text.slice(0, 320), atMs: line.startMs, untilMs: Math.min(line.endMs, opts.songMs ?? line.endMs) })),
      background: { kind: "style" },
      layers: [
        ...(index === 0 ? [{ id: "kicker", component: "text.kicker@1" as const, props: { text: opts.title.slice(0, 32) }, slot: "top" as const }] : []),
        { id: "words", component: "kinetic.words@1", props: {}, slot: "hero" },
        { id: "pulse", component: "audio.pulse@1", props: {}, slot: "bottom" },
      ],
      events: [],
    });
  }
  const plan = {
    schemaVersion: 1, mode: "lyrics", title: opts.title.slice(0, 120).padEnd(3, "."), logline: sung[0].text.slice(0, 280).padEnd(3, "."),
    language: opts.language, format: opts.format, targetMs: Math.min(180000, Math.max(15000, (sung[sung.length - 1].endMs || 15000))),
    styleId: "chalk-and-chai@1", voiceId: "song", songAssetId: opts.songAssetId, scenes,
  };
  const checked = validatePlan(plan);
  if (!checked.plan) throw new Error(`The lyrics could not become a storyboard: ${checked.issues[0]?.message ?? "invalid"}`);
  return checked.plan;
}

export function songLines(plan: Plan) {
  return plan.scenes.flatMap((scene) => scene.lines.map((line) => ({ sceneId: scene.id, lineId: line.id, text: line.text, startMs: line.atMs ?? 0, endMs: line.untilMs ?? (line.atMs ?? 0) + 3000 })));
}
