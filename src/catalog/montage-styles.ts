import { z } from "zod";

/**
 * Registered montage styles. Each is a tested preset: pacing, overlay layout, fonts, palette,
 * grade and sound. Ported from the "Claude Edits" reel analysis (aesthetic day-in-my-life vlog,
 * graphic tutorial, cinematic festival montage); see docs/reference/CLAUDE_EDITS_TOOLKIT.md.
 */
export const FONT_IDS = ["inter", "inter-black", "playfair", "instrument-serif", "pinyon", "great-vibes", "caveat", "bricolage"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FONTS: Record<FontId, { family: string; file: string; weight: number; style?: "italic" }> = {
  inter: { family: "Inter", file: "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2", weight: 400 },
  "inter-black": { family: "Inter Black", file: "node_modules/@fontsource/inter/files/inter-latin-900-normal.woff2", weight: 900 },
  playfair: { family: "Playfair Display", file: "node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2", weight: 700 },
  "instrument-serif": { family: "Instrument Serif", file: "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2", weight: 400, style: "italic" },
  pinyon: { family: "Pinyon Script", file: "node_modules/@fontsource/pinyon-script/files/pinyon-script-latin-400-normal.woff2", weight: 400 },
  "great-vibes": { family: "Great Vibes", file: "node_modules/@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2", weight: 400 },
  caveat: { family: "Caveat", file: "node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2", weight: 600 },
  bricolage: { family: "Bricolage Grotesque", file: "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", weight: 700 },
};

export const PACING = ["two-beats", "beat", "half-beat"] as const;
export const GRADES = ["none", "warm-film", "soft-cozy", "clean-bright", "cinematic"] as const;
export const OVERLAYS = ["none", "vlog", "tutorial", "cinematic"] as const;

export type MontageStyle = {
  id: string;
  label: string;
  note: string;
  pacing: (typeof PACING)[number];
  minShot: number;
  overlay: (typeof OVERLAYS)[number];
  sfx: boolean;
  /** Every Nth video shot plays faster (walking, transit). 0 = never. */
  rampEvery: number;
  fonts: { display: FontId; label: FontId; script: FontId };
  palette: { text: string; title: string; accent: string; night: string };
  grade: (typeof GRADES)[number];
};

export const MONTAGE_STYLES: MontageStyle[] = [
  {
    id: "beat-cut@1", label: "Beat cut", note: "Clean cuts every two beats, no text. Lets the footage speak.",
    pacing: "two-beats", minShot: 0.8, overlay: "none", sfx: false, rampEvery: 0,
    fonts: { display: "bricolage", label: "inter", script: "caveat" }, palette: { text: "#ffffff", title: "#ffffff", accent: "#ff5fa2", night: "#c4161c" }, grade: "none",
  },
  {
    id: "vlog-day@1", label: "Day in my life", note: "Aesthetic vlog: lavender serif title, VLOG badge, chapter list, time and activity labels, a script Good Night, and a soft sound on every cut.",
    pacing: "beat", minShot: 0.35, overlay: "vlog", sfx: true, rampEvery: 5,
    fonts: { display: "playfair", label: "inter", script: "pinyon" }, palette: { text: "#ffffff", title: "#d9cdf2", accent: "#ff4f58", night: "#c4161c" }, grade: "soft-cozy",
  },
  {
    id: "tutorial@1", label: "Tutorial", note: "Graphic how-to: a light and heavy headline, red pills, numbered handwritten steps and a save-this end card.",
    pacing: "two-beats", minShot: 1.2, overlay: "tutorial", sfx: true, rampEvery: 0,
    fonts: { display: "inter-black", label: "inter", script: "caveat" }, palette: { text: "#ffffff", title: "#ffffff", accent: "#e3323b", night: "#e3323b" }, grade: "clean-bright",
  },
  {
    id: "cinematic@1", label: "Cinematic", note: "Festival or travel energy: a heavy yellow title that blurs in, glowing words placed in the scene, punchy cuts.",
    pacing: "half-beat", minShot: 0.4, overlay: "cinematic", sfx: true, rampEvery: 4,
    fonts: { display: "inter-black", label: "inter", script: "great-vibes" }, palette: { text: "#ffffff", title: "#ffd31a", accent: "#ffd31a", night: "#ff8a00" }, grade: "cinematic",
  },
];

export function montageStyle(id: string | undefined | null): MontageStyle {
  return MONTAGE_STYLES.find((style) => style.id === id) ?? MONTAGE_STYLES[0];
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const words = (max: number) => z.string().trim().max(max).refine((value) => !/[<>{}]|—|–/.test(value), "No angle brackets, braces or em dashes");

/** What the creator (or their instructions) can set on a montage. Text is escaped by the compiler. */
export const montageSettingsSchema = z.object({
  styleId: z.string().max(40).default("beat-cut@1"),
  savedStyleId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
  kicker: words(40).default(""),
  title: words(60).default(""),
  subtitle: words(60).default(""),
  chapters: z.array(z.object({ time: words(16).default(""), label: words(28) })).max(8).default([]),
  outro: words(40).default(""),
  outroSub: words(40).default(""),
  accent: hex.optional(),
  displayFont: z.enum(FONT_IDS).optional(),
  pacing: z.enum(PACING).optional(),
  grade: z.enum(GRADES).optional(),
  sfx: z.boolean().optional(),
  /** The creator's own words on how to edit. Turned into the settings above, never run. */
  instructions: z.string().trim().max(1200).default(""),
}).strict();

export type MontageSettings = z.infer<typeof montageSettingsSchema>;

/** Style plus overrides: the creator's settings win over the preset. */
export function resolveMontage(settings: Partial<MontageSettings>, learned?: Partial<MontageStyle> | null): MontageStyle {
  const base = montageStyle(settings.styleId);
  const merged: MontageStyle = { ...base, ...(learned ?? {}), id: base.id, fonts: { ...base.fonts, ...(learned?.fonts ?? {}) }, palette: { ...base.palette, ...(learned?.palette ?? {}) } };
  if (settings.pacing) merged.pacing = settings.pacing;
  if (settings.grade) merged.grade = settings.grade;
  if (typeof settings.sfx === "boolean") merged.sfx = settings.sfx;
  if (settings.accent) merged.palette = { ...merged.palette, accent: settings.accent };
  if (settings.displayFont) merged.fonts = { ...merged.fonts, display: settings.displayFont };
  return merged;
}

export const GRADE_FILTER: Record<(typeof GRADES)[number], string> = {
  none: "",
  "warm-film": ",eq=contrast=1.05:saturation=1.08,colorbalance=rs=0.04:bs=-0.05:rh=0.05:bh=-0.04",
  "soft-cozy": ",eq=contrast=0.93:saturation=0.92:brightness=0.02,colorbalance=rh=0.03:bh=0.02",
  "clean-bright": ",eq=brightness=0.03:saturation=1.08:contrast=1.03",
  cinematic: ",eq=contrast=1.1:saturation=1.06,colorbalance=bs=0.05:rh=0.05",
};
