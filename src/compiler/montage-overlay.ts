import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FONTS, type FontId, type MontageSettings, type MontageStyle } from "../catalog/montage-styles";
import type { Format } from "../contracts/plan";
import { LAYOUTS } from "./compile";
import { assertSafeId, escapeHtml } from "./escape";

/**
 * A HyperFrames composition that lays the style's text and sound over an already-cut picture
 * track. Ported from the "Claude Edits" day-in-my-life template (title card, VLOG badge,
 * chapter list with the current chapter in the accent colour, time and activity labels, a
 * script Good Night), plus the tutorial and cinematic looks. Creator text is escaped; colours
 * and fonts come from validated settings only.
 */
export type SfxCue = { at: number; kind: "swish" | "click" | "pop" | "chime" };
export type OverlayPlan = {
  format: Format;
  seconds: number;
  style: MontageStyle;
  settings: Pick<MontageSettings, "kicker" | "title" | "subtitle" | "chapters" | "outro" | "outroSub">;
  /** Cut times in seconds, including 0 and the end. */
  cuts: number[];
  music: string | null;
};

type Tween = { target: string; from: Record<string, unknown>; to: Record<string, unknown>; at: number; duration: number; ease: string };

const ROOT = process.cwd();

/** Intro, chapter spans and outro, snapped to cut points so text changes on a cut. */
export function overlayTimeline(seconds: number, cuts: number[], chapters: number) {
  const snap = (t: number) => cuts.reduce((best, cut) => (Math.abs(cut - t) < Math.abs(best - t) ? cut : best), t);
  const intro = Math.min(2.4, Math.max(1.2, seconds * 0.15));
  const outro = Math.min(2.2, Math.max(1.2, seconds * 0.14));
  const bodyStart = snap(intro);
  const bodyEnd = Math.max(bodyStart + 0.5, snap(seconds - outro));
  const n = Math.max(0, chapters);
  const spans: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    const start = i === 0 ? bodyStart : snap(bodyStart + ((bodyEnd - bodyStart) * i) / n);
    const end = i === n - 1 ? bodyEnd : snap(bodyStart + ((bodyEnd - bodyStart) * (i + 1)) / n);
    if (end > start + 0.2) spans.push({ start, end });
  }
  return { intro: bodyStart, outroStart: bodyEnd, spans };
}

/** Sound cues: swish just before a chapter change, a click on other cuts, a pop on titles, a chime on the outro. */
export function sfxCues(plan: OverlayPlan): SfxCue[] {
  if (!plan.style.sfx) return [];
  const t = overlayTimeline(plan.seconds, plan.cuts, plan.settings.chapters.length);
  const chapterStarts = new Set(t.spans.map((span) => span.start.toFixed(3)));
  const cues: SfxCue[] = [{ at: 0.12, kind: "pop" }];
  for (const cut of plan.cuts) {
    if (cut <= 0.2 || cut >= plan.seconds - 0.2) continue;
    if (chapterStarts.has(cut.toFixed(3))) cues.push({ at: Math.max(0, cut - 0.08), kind: "swish" });
    else if (cut > t.intro && cut < t.outroStart) cues.push({ at: cut, kind: "click" });
  }
  if (plan.settings.outro || plan.style.overlay === "vlog") cues.push({ at: t.outroStart + 0.1, kind: "chime" });
  // Never stack two sounds closer than 120 ms.
  return cues.sort((a, b) => a.at - b.at).filter((cue, i, all) => i === 0 || cue.at - all[i - 1].at >= 0.12);
}

function fontFaces(dir: string, ids: FontId[]): string {
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  return [...new Set(ids)].map((id) => {
    const font = FONTS[id];
    copyFileSync(resolve(ROOT, font.file), resolve(dir, `assets/fonts/${id}.woff2`));
    return `@font-face { font-family: "${font.family}"; src: url("assets/fonts/${id}.woff2") format("woff2"); font-weight: ${font.weight}; font-style: ${font.style ?? "normal"}; font-display: block; }`;
  }).join("\n");
}

const fam = (id: FontId) => `"${FONTS[id].family}"`;

export function compileOverlay(plan: OverlayPlan, dir: string, files: { picture: string; music: string | null; sfx: Record<SfxCue["kind"], string> }): void {
  const L = LAYOUTS[plan.format];
  const k = Math.min(L.w, L.h) / 1080;
  const px = (n: number) => `${Math.round(n * k)}px`;
  const { style, settings } = plan;
  mkdirSync(resolve(dir, "assets/sfx"), { recursive: true });
  copyFileSync(resolve(ROOT, "node_modules/gsap/dist/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  copyFileSync(files.picture, resolve(dir, "assets/picture.mp4"));
  const musicExt = files.music ? files.music.split(".").pop()!.toLowerCase().replaceAll(/[^a-z0-9]/g, "") : "";
  if (files.music) copyFileSync(files.music, resolve(dir, `assets/music.${musicExt}`));
  for (const [kind, path] of Object.entries(files.sfx)) copyFileSync(path, resolve(dir, `assets/sfx/${kind}.wav`));

  const t = overlayTimeline(plan.seconds, plan.cuts, settings.chapters.length);
  const total = plan.seconds.toFixed(3);
  const tweens: Tween[] = [];
  const parts: string[] = [];
  const clip = (id: string, start: number, end: number, cls: string, inner: string, track = 2) =>
    `<div id="${assertSafeId(id)}" class="clip ${cls}" data-start="${start.toFixed(3)}" data-duration="${Math.max(0.05, end - start).toFixed(3)}" data-track-index="${track}">${inner}</div>`;
  const span = (id: string, cls: string, text: string) => `<span id="${assertSafeId(id)}" class="${cls}">${escapeHtml(text)}</span>`;

  const scrim = `<div id="scrim" class="clip scrim" data-start="0" data-duration="${total}" data-track-index="1"></div>`;
  parts.push(scrim);

  if (style.overlay === "vlog") {
    const lines = (settings.title || "day in my life").split(/\s+/).reduce<string[]>((rows, word) => {
      const last = rows[rows.length - 1];
      if (last && (last + " " + word).length <= 9) rows[rows.length - 1] = `${last} ${word}`;
      else rows.push(word);
      return rows;
    }, []).slice(0, 4);
    parts.push(clip("title", 0, t.intro, "title-card", [
      settings.kicker ? span("t-kicker", "kicker", settings.kicker) : "",
      `<div class="t-big">${lines.map((line, i) => span(`t-line${i}`, "t-line", line)).join("")}</div>`,
      settings.subtitle ? span("t-sub", "t-script", settings.subtitle) : "",
    ].join("")));
    if (settings.kicker) tweens.push({ target: "t-kicker", from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, at: 0.05, duration: 0.3, ease: "back.out" });
    lines.forEach((_, i) => tweens.push({ target: `t-line${i}`, from: { opacity: 0, filter: "blur(18px)", y: 20 }, to: { opacity: 1, filter: "blur(0px)", y: 0 }, at: 0.15 + i * 0.12, duration: 0.45, ease: "power3.out" }));
    if (settings.subtitle) tweens.push({ target: "t-sub", from: { clipPath: "inset(0 100% 0 0)" }, to: { clipPath: "inset(0 0% 0 0)" }, at: 0.55, duration: 0.6, ease: "power1.inOut" });

    if (t.spans.length) {
      const list = settings.chapters.map((ch, i) => span(`tag${i}`, "tag", ch.label + (i < settings.chapters.length - 1 ? "," : ""))).join("");
      parts.push(clip("badge", t.intro, t.outroStart, "badge-wrap", `<div class="badge"><b>VLOG</b><small>${escapeHtml(settings.subtitle || "day in my life")}</small></div><div class="tags">${list}</div>`));
      tweens.push({ target: "badge", from: { opacity: 0, y: -16 }, to: { opacity: 1, y: 0 }, at: t.intro, duration: 0.25, ease: "power3.out" });
      t.spans.forEach((s, i) => {
        const ch = settings.chapters[i];
        parts.push(clip(`ch${i}`, s.start, s.end, "ch-label", `${ch.time ? span(`cht${i}`, "ch-time", ch.time) : ""}${span(`cha${i}`, "ch-act", ch.label)}`));
        if (ch.time) tweens.push({ target: `cht${i}`, from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, at: s.start + 0.04, duration: 0.28, ease: "back.out" });
        tweens.push({ target: `cha${i}`, from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, at: s.start + 0.1, duration: 0.28, ease: "back.out" });
        tweens.push({ target: `tag${i}`, from: { color: style.palette.text }, to: { color: style.palette.accent }, at: s.start, duration: 0.08, ease: "none" });
        tweens.push({ target: `tag${i}`, from: { color: style.palette.accent }, to: { color: style.palette.text }, at: s.end - 0.08, duration: 0.08, ease: "none" });
      });
    }
    const [o1, ...rest] = (settings.outro || "Good Night").split(/\s+/);
    parts.push(clip("outro", t.outroStart, plan.seconds, "outro", `<div class="o-script">${span("o1", "o-line", o1)}<br>${span("o2", "o-line", rest.join(" ") || " ")}</div>${span("osub", "o-sub", settings.outroSub || "[thanks for watching]")}`));
    tweens.push({ target: "o1", from: { clipPath: "inset(0 100% 0 0)" }, to: { clipPath: "inset(0 0% 0 0)" }, at: t.outroStart + 0.1, duration: 0.45, ease: "power1.inOut" });
    tweens.push({ target: "o2", from: { clipPath: "inset(0 100% 0 0)" }, to: { clipPath: "inset(0 0% 0 0)" }, at: t.outroStart + 0.35, duration: 0.4, ease: "power1.inOut" });
    tweens.push({ target: "osub", from: { opacity: 0, y: 10 }, to: { opacity: 1, y: 0 }, at: t.outroStart + 0.7, duration: 0.25, ease: "power2.out" });
  } else if (style.overlay === "tutorial") {
    const [light, ...heavy] = (settings.title || "the basics").split(/\s+/);
    parts.push(clip("title", 0, t.intro, "tut-title", `${span("tl", "tut-light", light)} ${span("th", "tut-heavy", heavy.join(" ").toUpperCase() || "BASICS")}${settings.kicker ? `<br>${span("tp", "pill", settings.kicker)}` : ""}`));
    tweens.push({ target: "tl", from: { opacity: 0, x: -30 }, to: { opacity: 1, x: 0 }, at: 0.1, duration: 0.35, ease: "power3.out" });
    tweens.push({ target: "th", from: { opacity: 0, scale: 1.3 }, to: { opacity: 1, scale: 1 }, at: 0.3, duration: 0.35, ease: "back.out" });
    if (settings.kicker) tweens.push({ target: "tp", from: { opacity: 0, y: 20 }, to: { opacity: 1, y: 0 }, at: 0.55, duration: 0.3, ease: "power2.out" });
    t.spans.forEach((s, i) => {
      const ch = settings.chapters[i];
      parts.push(clip(`ch${i}`, s.start, s.end, "step", `${span(`sn${i}`, "step-n", String(i + 1))}${span(`st${i}`, "step-note", ch.label)}`));
      tweens.push({ target: `sn${i}`, from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1 }, at: s.start + 0.04, duration: 0.25, ease: "back.out" });
      tweens.push({ target: `st${i}`, from: { clipPath: "inset(0 100% 0 0)" }, to: { clipPath: "inset(0 0% 0 0)" }, at: s.start + 0.15, duration: 0.5, ease: "power1.inOut" });
    });
    parts.push(clip("outro", t.outroStart, plan.seconds, "tut-end", `${span("save", "save", settings.outro || "Save this reel")}${span("osub", "pill", settings.outroSub || "try it today")}`));
    tweens.push({ target: "save", from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, at: t.outroStart + 0.1, duration: 0.35, ease: "power3.out" });
    tweens.push({ target: "osub", from: { opacity: 0 }, to: { opacity: 1 }, at: t.outroStart + 0.4, duration: 0.25, ease: "none" });
  } else if (style.overlay === "cinematic") {
    parts.push(clip("title", 0, t.intro, "cin-title", `${span("ct", "cin-big", (settings.title || "the journey").toUpperCase())}${settings.subtitle ? span("cs", "cin-sub", settings.subtitle) : ""}`));
    tweens.push({ target: "ct", from: { opacity: 0, filter: "blur(24px)", scale: 1.25 }, to: { opacity: 1, filter: "blur(0px)", scale: 1 }, at: 0.1, duration: 0.7, ease: "power3.out" });
    if (settings.subtitle) tweens.push({ target: "cs", from: { opacity: 0, letterSpacing: "0.6em" }, to: { opacity: 1, letterSpacing: "0.18em" }, at: 0.5, duration: 0.6, ease: "power2.out" });
    t.spans.forEach((s, i) => {
      const ch = settings.chapters[i];
      parts.push(clip(`ch${i}`, s.start, s.end, "glow", span(`gw${i}`, "glow-word", ch.label)));
      tweens.push({ target: `gw${i}`, from: { opacity: 0, scale: 0.7, filter: "blur(10px)" }, to: { opacity: 1, scale: 1, filter: "blur(0px)" }, at: s.start + 0.05, duration: 0.35, ease: "back.out" });
    });
    parts.push(clip("outro", t.outroStart, plan.seconds, "cin-title", span("ot", "cin-big", (settings.outro || "until next time").toUpperCase())));
    tweens.push({ target: "ot", from: { opacity: 0, filter: "blur(20px)" }, to: { opacity: 1, filter: "blur(0px)" }, at: t.outroStart + 0.1, duration: 0.6, ease: "power3.out" });
  }

  const cues = sfxCues(plan);
  const audio = [
    files.music ? `<audio id="music" src="assets/music.${musicExt}" data-start="0" data-duration="${total}" data-track-index="5" data-volume="${style.sfx ? 0.8 : 1}"></audio>` : "",
    ...cues.map((cue, i) => `<audio id="${assertSafeId(`sfx-${i}`)}" src="assets/sfx/${cue.kind}.wav" data-start="${cue.at.toFixed(3)}" data-duration="${cue.kind === "chime" ? "1.200" : "0.300"}" data-track-index="${6 + (i % 3)}" data-volume="${cue.kind === "click" ? 0.45 : 0.6}"></audio>`),
  ].filter(Boolean);

  const P = style.palette;
  const css = `
  ${fontFaces(dir, [style.fonts.display, style.fonts.label, style.fonts.script])}
  html, body { margin: 0; background: #000; }
  #root { position: relative; width: ${L.w}px; height: ${L.h}px; overflow: hidden; background: #000; }
  #bg { position: absolute; inset: 0; width: ${L.w}px; height: ${L.h}px; object-fit: cover; }
  .scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,.5), rgba(0,0,0,.18) 30%, rgba(0,0,0,0) 45%, rgba(0,0,0,0) 62%, rgba(0,0,0,.35)); }
  .clip { position: absolute; }
  .kicker { display: inline-block; font-family: ${fam(style.fonts.label)}; font-size: ${px(40)}; color: ${P.text}; letter-spacing: -0.03em; margin-bottom: ${px(18)}; text-shadow: 0 2px 12px rgba(0,0,0,.4); }
  .title-card { left: 0; right: 0; top: 30%; text-align: center; }
  .t-big { display: flex; flex-direction: column; align-items: center; }
  .t-line { display: block; font-family: ${fam(style.fonts.display)}; font-weight: ${FONTS[style.fonts.display].weight}; font-size: ${px(190)}; line-height: .92; color: ${P.title}; letter-spacing: -0.02em; text-shadow: 0 6px 40px rgba(0,0,0,.35); }
  .t-script { display: inline-block; margin-top: ${px(24)}; font-family: ${fam(style.fonts.script)}; font-size: ${px(84)}; color: ${P.text}; text-shadow: 0 2px 16px rgba(0,0,0,.45); }
  .badge-wrap { left: ${px(70)}; right: ${px(70)}; top: ${px(200)}; height: ${px(300)}; }
  .badge { position: absolute; left: 0; top: 0; color: ${P.text}; line-height: .9; font-family: ${fam(style.fonts.label)}; text-shadow: 0 2px 12px rgba(0,0,0,.35); }
  .badge b { display: block; font-family: "Inter Black", ${fam(style.fonts.label)}; font-weight: 900; font-size: ${px(92)}; letter-spacing: -0.07em; }
  .badge small { display: block; font-size: ${px(32)}; letter-spacing: -0.05em; margin-top: ${px(4)}; }
  .tags { position: absolute; right: 0; top: ${px(8)}; width: ${px(320)}; text-align: right; font-family: ${fam(style.fonts.label)}; font-size: ${px(30)}; letter-spacing: -0.05em; line-height: 1.12; text-shadow: 0 2px 12px rgba(0,0,0,.35); }
  .tag { display: block; color: ${P.text}; }
  .ch-label { left: ${px(70)}; right: ${px(70)}; top: 47%; height: ${px(70)}; }
  .ch-time, .ch-act { position: absolute; top: 0; font-family: ${fam(style.fonts.label)}; font-size: ${px(48)}; letter-spacing: -0.06em; color: ${P.text}; text-shadow: 0 2px 12px rgba(0,0,0,.45); }
  .ch-time { left: 0; } .ch-act { right: 0; text-align: right; }
  .outro { left: 0; right: 0; top: 33%; text-align: center; }
  .o-script { font-family: ${fam(style.fonts.script)}; font-size: ${px(240)}; line-height: .85; color: ${P.text}; text-shadow: 0 4px 24px rgba(0,0,0,.45); }
  .o-line { display: inline-block; padding: 0 ${px(30)}; }
  .o-sub { display: block; margin-top: ${px(40)}; font-family: ${fam(style.fonts.label)}; font-size: ${px(40)}; letter-spacing: -0.05em; color: ${P.text}; }
  .tut-title { left: ${px(70)}; right: ${px(70)}; top: 22%; }
  .tut-light { font-family: ${fam(style.fonts.label)}; font-size: ${px(110)}; color: ${P.text}; letter-spacing: -0.05em; }
  .tut-heavy { font-family: "Inter Black", ${fam(style.fonts.display)}; font-weight: 900; font-size: ${px(140)}; color: ${P.text}; letter-spacing: -0.06em; }
  .pill { display: inline-block; margin-top: ${px(26)}; padding: ${px(10)} ${px(28)}; border-radius: ${px(60)}; background: ${P.accent}; color: #fff; font-family: ${fam(style.fonts.label)}; font-size: ${px(40)}; }
  .step { left: ${px(70)}; right: ${px(70)}; bottom: 18%; display: flex; align-items: center; gap: ${px(24)}; }
  .step-n { flex: none; display: grid; place-items: center; width: ${px(96)}; height: ${px(96)}; border-radius: 50%; background: ${P.accent}; color: #fff; font-family: "Inter Black", sans-serif; font-weight: 900; font-size: ${px(56)}; }
  .step-note { font-family: ${fam(style.fonts.script)}; font-size: ${px(76)}; color: ${P.text}; text-shadow: 0 2px 14px rgba(0,0,0,.5); }
  .tut-end { left: 0; right: 0; top: 38%; text-align: center; }
  .save { display: block; font-family: "Inter Black", sans-serif; font-weight: 900; font-size: ${px(120)}; letter-spacing: -0.05em; color: ${P.text}; }
  .cin-title { left: 0; right: 0; top: 36%; text-align: center; }
  .cin-big { display: block; font-family: "Inter Black", ${fam(style.fonts.display)}; font-weight: 900; font-size: ${px(170)}; letter-spacing: -0.04em; line-height: .9; color: ${P.title}; text-shadow: 0 0 40px rgba(0,0,0,.4); }
  .cin-sub { display: block; margin-top: ${px(20)}; font-family: ${fam(style.fonts.label)}; font-size: ${px(36)}; letter-spacing: .18em; color: ${P.text}; text-transform: uppercase; }
  .glow { left: 0; right: 0; top: 58%; text-align: center; }
  .glow-word { font-family: ${fam(style.fonts.script)}; font-size: ${px(140)}; color: #fff; text-shadow: 0 0 12px ${P.accent}, 0 0 32px ${P.accent}, 0 0 64px ${P.night}; }
  `;

  const script = `const tweens = ${JSON.stringify(tweens)};
const tl = gsap.timeline({ paused: true });
const seen = new Set();
for (const tw of tweens) {
  const first = !seen.has(tw.target);
  seen.add(tw.target);
  tl.fromTo("#" + tw.target, tw.from, Object.assign({}, tw.to, { duration: tw.duration, ease: tw.ease === "back.out" ? "back.out(2)" : tw.ease, immediateRender: first }), tw.at);
}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;`;

  const html = `<!doctype html>
<html lang="en" data-resolution="${L.resolution}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${L.w}, height=${L.h}" />
  <title>Montage</title>
  <script src="assets/gsap.min.js"></script>
  <style>${css}</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${L.w}" data-height="${L.h}">
    <video id="bg" class="clip" src="assets/picture.mp4" data-start="0" data-duration="${total}" data-track-index="0" muted playsinline></video>
    ${parts.join("\n    ")}
    ${audio.join("\n    ")}
  </div>
  <script>${script}</script>
</body>
</html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } }, null, 2));
}
