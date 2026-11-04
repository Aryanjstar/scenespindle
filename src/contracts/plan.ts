import { z } from "zod";
import { findProtected } from "../config/protected";

export const PURPOSES = ["hook", "setup", "explain", "example", "recap", "cta"] as const;
export const LANGUAGES = ["en", "hi", "hinglish"] as const;
export const PLAN_MODES = ["explainer", "code_lab", "audio", "story", "cartoon", "lyrics"] as const;
export const ILLUSTRATED = new Set(["story", "cartoon"]);
export const FORMATS = ["9x16", "16x9", "1x1"] as const;
export type Language = (typeof LANGUAGES)[number];
export type Format = (typeof FORMATS)[number];

export const VISUALS = [
  "none",
  "lattu-still",
  "lattu-spin",
  "orbit-pull",
  "orbit-side",
  "orbit-both",
  "compare",
  "bullets",
] as const;

const text = (max: number) => z.string().max(max);

export const briefSceneSchema = z.object({
  purpose: z.enum(PURPOSES),
  narration: z.string().min(8).max(320),
  kicker: text(32),
  title: text(48),
  slam: text(12),
  handwritten: text(28),
  visual: z.enum(VISUALS),
  left: text(22),
  right: text(22),
  leftLabel: text(16),
  rightLabel: text(16),
  bullets: text(110),
});

export const briefSchema = z.object({
  title: z.string().min(3).max(80),
  logline: z.string().min(3).max(180),
  scenes: z.array(briefSceneSchema).min(4).max(6),
});

export type Brief = z.infer<typeof briefSchema>;

const layerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,24}$/),
  component: z.enum([
    "text.kicker@1",
    "text.title@1",
    "text.slam@1",
    "text.handwritten@1",
    "obj.lattu@1",
    "diagram.orbit@1",
    "diagram.compare@1",
    "text.bullets@1",
    "trace.array@1",
    "trace.stack@1",
    "code.listing@1",
    "kinetic.words@1",
    "audio.pulse@1",
    "image.still@1",
    "stage.perform@1",
  ]),
  props: z.record(z.string(), z.unknown()).default({}),
  slot: z.enum(["top", "title", "center", "bottom", "hero", "full"]),
});

const lineSchema = z.object({
  id: z.string().regex(/^l[1-8]$/),
  text: z.string().min(1).max(320),
  spoken: z.string().min(1).max(400).optional(),
  // Lyric videos only: creator-supplied times from their LRC file.
  atMs: z.number().int().min(0).max(1_200_000).optional(),
  untilMs: z.number().int().min(0).max(1_200_000).optional(),
});

const cueSchema = z.union([
  z.object({ lineId: z.string(), phrase: z.string().min(1), occurrence: z.number().int().min(1).optional() }),
  z.object({ lineId: z.string(), at: z.enum(["start", "end"]) }),
]);

const eventSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,24}$/),
  target: z.string(),
  action: z.enum(["reveal"]),
  cue: cueSchema,
});

export const planSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(PLAN_MODES),
  title: z.string().min(3).max(120),
  logline: z.string().min(3).max(280),
  language: z.enum(LANGUAGES),
  format: z.enum(FORMATS),
  targetMs: z.number().int().min(15000).max(180000),
  styleId: z.literal("chalk-and-chai@1"),
  voiceId: z.string().min(3).max(80),
  songAssetId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  scenes: z.array(
    z.object({
      id: z.string().regex(/^s([1-9]|[1-3][0-9]|40)$/),
      purpose: z.enum(PURPOSES),
      lines: z.array(lineSchema).min(1).max(8),
      background: z.object({ kind: z.literal("style") }),
      layers: z.array(layerSchema).min(1).max(8),
      events: z.array(eventSchema).max(8),
      holdMs: z.number().int().min(0).max(1200).optional(),
    }),
  ).min(1).max(15),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanIssue = { path: string; message: string };

const LIMITS: Record<string, Record<string, number>> = {
  "text.kicker@1": { text: 32 },
  "text.title@1": { text: 48 },
  "text.slam@1": { text: 12 },
  "text.handwritten@1": { text: 28 },
  "diagram.compare@1": { left: 22, right: 22, leftLabel: 16, rightLabel: 16 },
};

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function phraseOccurs(line: string, phrase: string, occurrence = 1): boolean {
  const hay = tokens(line);
  const needle = tokens(phrase);
  if (needle.length === 0) return false;
  let found = 0;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((word, j) => hay[i + j] === word)) found += 1;
  }
  return found >= occurrence;
}

function screenStrings(plan: Plan): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [
    { path: "title", value: plan.title },
    { path: "logline", value: plan.logline },
  ];
  plan.scenes.forEach((scene, s) => {
    scene.lines.forEach((line, l) => {
      out.push({ path: `scenes.${s}.lines.${l}.text`, value: line.text });
    });
    scene.layers.forEach((layer, i) => {
      for (const [key, value] of Object.entries(layer.props)) {
        if (typeof value === "string") out.push({ path: `scenes.${s}.layers.${i}.props.${key}`, value });
        if (Array.isArray(value)) {
          value.forEach((item, n) => {
            if (typeof item === "string") {
              out.push({ path: `scenes.${s}.layers.${i}.props.${key}.${n}`, value: item });
            }
          });
        }
      }
    });
  });
  return out;
}

export function validatePlan(input: unknown): { plan: Plan | null; issues: PlanIssue[] } {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return {
      plan: null,
      issues: parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const plan = parsed.data;
  const issues: PlanIssue[] = [];
  const sceneIds = new Set<string>();

  for (const item of screenStrings(plan)) {
    const hit = findProtected(item.value);
    if (hit) issues.push({ path: item.path, message: `Protected name "${hit}" is not allowed` });
    if (item.value.includes("—") || item.value.includes("–")) {
      issues.push({ path: item.path, message: "Em dash is not allowed on screen or in the script" });
    }
  }

  plan.scenes.forEach((scene, s) => {
    if (sceneIds.has(scene.id)) issues.push({ path: `scenes.${s}.id`, message: "Duplicate scene id" });
    sceneIds.add(scene.id);
    const lineIds = new Set(scene.lines.map((line) => line.id));
    const layerIds = new Set<string>();
    scene.layers.forEach((layer, i) => {
      if (layerIds.has(layer.id)) issues.push({ path: `scenes.${s}.layers.${i}.id`, message: "Duplicate layer id" });
      layerIds.add(layer.id);
      const limits = LIMITS[layer.component];
      if (limits) {
        for (const [key, max] of Object.entries(limits)) {
          const value = layer.props[key];
          if (typeof value !== "string" || value.trim().length === 0) {
            issues.push({ path: `scenes.${s}.layers.${i}.props.${key}`, message: "Missing text" });
          } else if (value.length > max) {
            issues.push({ path: `scenes.${s}.layers.${i}.props.${key}`, message: `Over ${max} characters` });
          }
        }
      }
      if (layer.component === "text.bullets@1") {
        const items = layer.props.items;
        if (!Array.isArray(items) || items.length < 2 || items.length > 3) {
          issues.push({ path: `scenes.${s}.layers.${i}.props.items`, message: "Bullets need 2 or 3 items" });
        } else if (items.some((item) => typeof item !== "string" || item.length > 32 || item.length === 0)) {
          issues.push({ path: `scenes.${s}.layers.${i}.props.items`, message: "Each bullet is 1 to 32 characters" });
        }
      }
      if (layer.component === "trace.array@1" || layer.component === "trace.stack@1") {
        const from = layer.props.from;
        const to = layer.props.to;
        if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) < (from as number) || (to as number) > 200) {
          issues.push({ path: `scenes.${s}.layers.${i}.props`, message: "Trace layers need integer from <= to (0 to 200)" });
        }
      }
      if (layer.component === "stage.perform@1") {
        const { action, look, rigs, set } = layer.props as { action?: unknown; look?: unknown; rigs?: unknown; set?: unknown };
        if (action !== "talk" && action !== "walk" && action !== "turn" && action !== "wave" && action !== "hold") {
          issues.push({ path: `scenes.${s}.layers.${i}.props.action`, message: "Stage action must be talk, walk, turn, wave or hold" });
        }
        if (look !== "storybook" && look !== "cartoon") {
          issues.push({ path: `scenes.${s}.layers.${i}.props.look`, message: "Stage look must be storybook or cartoon" });
        }
        if (rigs !== 1 && rigs !== 2) {
          issues.push({ path: `scenes.${s}.layers.${i}.props.rigs`, message: "A stage has one or two performers" });
        }
        if (set !== "home" && set !== "bank" && set !== "lane") {
          issues.push({ path: `scenes.${s}.layers.${i}.props.set`, message: "Stage set must be home, bank or lane" });
        }
      }
      if (layer.component === "image.still@1") {
        const { prompt, assetId, characterIds } = layer.props as { prompt?: unknown; assetId?: unknown; characterIds?: unknown };
        if (typeof prompt !== "string" || prompt.trim().length < 8 || prompt.length > 600) issues.push({ path: `scenes.${s}.layers.${i}.props.prompt`, message: "A still needs a picture description of 8 to 600 characters" });
        if (assetId !== undefined && assetId !== null && (typeof assetId !== "string" || !/^[a-f0-9]{24}$/.test(assetId))) issues.push({ path: `scenes.${s}.layers.${i}.props.assetId`, message: "Invalid image id" });
        if (characterIds !== undefined && (!Array.isArray(characterIds) || characterIds.length > 4 || characterIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)))) issues.push({ path: `scenes.${s}.layers.${i}.props.characterIds`, message: "Up to four character ids" });
      }
      if (layer.component === "code.listing@1") {
        const line = layer.props.highlight;
        if (line !== undefined && (!Number.isInteger(line) || (line as number) < 0 || (line as number) > 200)) {
          issues.push({ path: `scenes.${s}.layers.${i}.props.highlight`, message: "Highlight is a line number" });
        }
      }
      if (layer.component === "obj.lattu@1" && layer.props.state !== "still" && layer.props.state !== "spinning") {
        issues.push({ path: `scenes.${s}.layers.${i}.props.state`, message: "Lattu state must be still or spinning" });
      }
      if (layer.component === "diagram.orbit@1") {
        const pull = layer.props.showPull;
        const side = layer.props.showSideways;
        if (typeof pull !== "boolean" || typeof side !== "boolean") {
          issues.push({ path: `scenes.${s}.layers.${i}.props`, message: "Orbit needs showPull and showSideways booleans" });
        }
      }
    });
    scene.events.forEach((event, e) => {
      if (!layerIds.has(event.target)) {
        issues.push({ path: `scenes.${s}.events.${e}.target`, message: "Event target is not a layer in this scene" });
      }
      const line = scene.lines.find((item) => item.id === event.cue.lineId);
      if (!line) {
        issues.push({ path: `scenes.${s}.events.${e}.cue.lineId`, message: "Cue line does not exist" });
        return;
      }
      if ("phrase" in event.cue && !phraseOccurs(line.spoken ?? line.text, event.cue.phrase, event.cue.occurrence ?? 1)) {
        issues.push({ path: `scenes.${s}.events.${e}.cue.phrase`, message: "Phrase is not in the spoken line" });
      }
    });
    if (!lineIds.has("l1")) issues.push({ path: `scenes.${s}.lines`, message: "Scene needs line l1" });
  });

  if (plan.mode !== "audio" && plan.mode !== "lyrics" && plan.scenes.some((scene) => scene.layers.some((layer) => layer.component === "kinetic.words@1"))) {
    issues.push({ path: "mode", message: "Kinetic word layers need an Audio or Lyrics plan" });
  }
  if (!ILLUSTRATED.has(plan.mode) && plan.scenes.some((scene) => scene.layers.some((layer) => layer.component === "stage.perform@1"))) {
    issues.push({ path: "mode", message: "A performed stage needs a Story or Cartoon plan" });
  }
  // Scene-count rules per mode: short explainers stay 4 to 6 scenes; stories use 6 to 15 beats.
  const [minScenes, maxScenes] = ILLUSTRATED.has(plan.mode) ? [3, 15] : plan.mode === "lyrics" ? [1, 15] : [4, 6];
  if (plan.scenes.length < minScenes || plan.scenes.length > maxScenes) issues.push({ path: "scenes", message: `${plan.mode} plans need ${minScenes} to ${maxScenes} scenes` });
  if (plan.mode !== "lyrics" && plan.scenes.some((scene) => scene.lines.length > 2)) issues.push({ path: "scenes", message: "Scenes have at most two narration lines" });
  if (plan.mode === "lyrics") {
    if (!plan.songAssetId) issues.push({ path: "songAssetId", message: "A lyric video needs a song" });
    let previous = -1;
    for (const line of plan.scenes.flatMap((scene) => scene.lines)) {
      if (line.atMs === undefined || line.untilMs === undefined || line.untilMs <= line.atMs || line.atMs < previous) {
        issues.push({ path: "scenes", message: "Lyric lines need increasing times from the lyric file" });
        break;
      }
      previous = line.atMs;
    }
  }
  if (plan.mode !== "code_lab" && plan.scenes.some((scene) => scene.layers.some((layer) => layer.component.startsWith("trace.") || layer.component.startsWith("code.")))) {
    issues.push({ path: "mode", message: "Trace and code layers need a Code Lab plan" });
  }
  return { plan: issues.length ? null : plan, issues };
}

function clean(value: string): string {
  return value.replaceAll("—", ", ").replaceAll("–", ", ").replaceAll(/\s+/g, " ").trim();
}

export function expandBrief(brief: Brief, voiceId: string, settings: { language?: Language; format?: Format; targetMs?: number } = {}): unknown {
  const scenes = brief.scenes.map((scene, index) => {
    const layers: unknown[] = [];
    const kicker = clean(scene.kicker);
    const title = clean(scene.title);
    const slam = clean(scene.slam);
    const note = clean(scene.handwritten);
    if (kicker) layers.push({ id: "kicker", component: "text.kicker@1", props: { text: kicker }, slot: "top" });
    if (title) {
      layers.push({
        id: "title",
        component: "text.title@1",
        props: { text: title },
        slot: scene.visual === "none" && !slam ? "hero" : "title",
      });
    }
    if (slam) layers.push({ id: "slam", component: "text.slam@1", props: { text: slam }, slot: "hero" });
    if (note) layers.push({ id: "note", component: "text.handwritten@1", props: { text: note }, slot: "bottom" });
    if (scene.visual === "lattu-still" || scene.visual === "lattu-spin") {
      layers.push({
        id: "visual",
        component: "obj.lattu@1",
        props: { state: scene.visual === "lattu-spin" ? "spinning" : "still" },
        slot: "center",
      });
    }
    if (scene.visual === "orbit-pull" || scene.visual === "orbit-side" || scene.visual === "orbit-both") {
      layers.push({
        id: "visual",
        component: "diagram.orbit@1",
        props: {
          showPull: scene.visual !== "orbit-side",
          showSideways: scene.visual !== "orbit-pull",
        },
        slot: "center",
      });
    }
    if (scene.visual === "compare") {
      layers.push({
        id: "visual",
        component: "diagram.compare@1",
        props: {
          left: clean(scene.left),
          right: clean(scene.right),
          leftLabel: clean(scene.leftLabel),
          rightLabel: clean(scene.rightLabel),
        },
        slot: "center",
      });
    }
    if (scene.visual === "bullets") {
      const items = scene.bullets.split("|").map(clean).filter(Boolean).slice(0, 3);
      layers.push({ id: "visual", component: "text.bullets@1", props: { items }, slot: "center" });
    }
    return {
      id: `s${index + 1}`,
      purpose: scene.purpose,
      lines: [{ id: "l1", text: clean(scene.narration) }],
      background: { kind: "style" },
      layers,
      events: [],
      holdMs: index === brief.scenes.length - 1 ? 700 : 180,
    };
  });

  return {
    schemaVersion: 1,
    mode: "explainer",
    title: clean(brief.title),
    logline: clean(brief.logline),
    language: settings.language ?? "en",
    format: settings.format ?? "9x16",
    targetMs: Math.min(180000, Math.max(15000, settings.targetMs ?? 45000)),
    styleId: "chalk-and-chai@1",
    voiceId,
    scenes,
  };
}
