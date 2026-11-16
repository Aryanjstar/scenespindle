import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plan } from "../contracts/plan";
import { chalkAndChai as ink } from "../catalog/style";
import { assertSafeId, escapeHtml } from "./escape";

export type TimedWord = { text: string; startMs: number; endMs: number };

export type TimedLine = {
  sceneId: string;
  lineId: string;
  text: string;
  audioFile: string;
  startMs: number;
  durationMs: number;
  words: TimedWord[];
};

export type Timeline = {
  durationMs: number;
  scenes: { id: string; startMs: number; durationMs: number }[];
  lines: TimedLine[];
};

type Tween = {
  target: string;
  from: Record<string, number>;
  to: Record<string, number>;
  at: number;
  duration: number;
  ease: string;
};

const EASES = new Set(["power2.out", "power3.out", "power2.inOut", "none", "back.out"]);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function tween(partial: Tween): Tween {
  if (!EASES.has(partial.ease)) throw new Error(`Ease not allowed: ${partial.ease}`);
  for (const bag of [partial.from, partial.to]) {
    for (const value of Object.values(bag)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Tween values must be numbers");
    }
  }
  assertSafeId(partial.target);
  return partial;
}

function lattuSvg(): string {
  return `<svg viewBox="0 0 200 250" aria-hidden="true">
    <ellipse cx="100" cy="214" rx="54" ry="10" fill="#2A2238" opacity="0.12"/>
    <path d="M100 28 C 108 28 112 40 112 52 L 158 168 L 42 168 L 88 52 C 88 40 92 28 100 28 Z" fill="${ink.earth}"/>
    <ellipse cx="100" cy="168" rx="58" ry="22" fill="${ink.moon}"/>
    <ellipse cx="100" cy="162" rx="40" ry="12" fill="#FFE3A8"/>
    <circle cx="84" cy="108" r="7" fill="${ink.ink}"/>
    <circle cx="116" cy="108" r="7" fill="${ink.ink}"/>
    <circle cx="86" cy="106" r="2" fill="#FBF4E8"/>
    <circle cx="118" cy="106" r="2" fill="#FBF4E8"/>
    <path d="M100 188 C 132 214 156 206 168 230" fill="none" stroke="${ink.ink}" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

function layerHtml(plan: Plan, sceneIndex: number, startSec: number, durationSec: number): { html: string; tweens: Tween[] } {
  const scene = plan.scenes[sceneIndex];
  if (!scene) return { html: "", tweens: [] };
  const tweens: Tween[] = [];
  const chunks: string[] = [];
  for (const layer of scene.layers) {
    const id = assertSafeId(`${scene.id}-${layer.id}`);
    const at = startSec + 0.12;
    if (layer.component === "text.kicker@1") {
      chunks.push(`<div class="slot-top"><p id="${id}" class="kicker">${escapeHtml(String(layer.props.text))}</p></div>`);
      tweens.push(tween({ target: id, from: { y: 18, opacity: 0 }, to: { y: 0, opacity: 1 }, at, duration: 0.45, ease: "power3.out" }));
    } else if (layer.component === "text.title@1") {
      const slot = layer.slot === "hero" ? "slot-hero" : "slot-title";
      const size = String(layer.props.text).length > 22 ? 68 : 92;
      chunks.push(`<div class="${slot}"><h1 id="${id}" class="title" style="font-size:${size}px">${escapeHtml(String(layer.props.text))}</h1><div id="${id}-line" class="underline"></div></div>`);
      tweens.push(tween({ target: id, from: { y: 28, opacity: 0 }, to: { y: 0, opacity: 1 }, at: at + 0.05, duration: 0.55, ease: "power3.out" }));
      tweens.push(tween({ target: `${id}-line`, from: { scaleX: 0 }, to: { scaleX: 1 }, at: at + 0.28, duration: 0.4, ease: "power2.out" }));
    } else if (layer.component === "text.slam@1") {
      chunks.push(`<div class="slot-hero"><p id="${id}" class="slam">${escapeHtml(String(layer.props.text))}</p></div>`);
      tweens.push(tween({ target: id, from: { scale: 1.18, opacity: 0 }, to: { scale: 1, opacity: 1 }, at, duration: 0.42, ease: "power3.out" }));
    } else if (layer.component === "text.handwritten@1") {
      chunks.push(`<div class="slot-bottom"><p id="${id}" class="note">${escapeHtml(String(layer.props.text))}</p></div>`);
      tweens.push(tween({ target: id, from: { y: 16, opacity: 0, rotation: -8 }, to: { y: 0, opacity: 1, rotation: -4 }, at: at + 0.2, duration: 0.5, ease: "power3.out" }));
    } else if (layer.component === "obj.lattu@1") {
      chunks.push(`<div class="slot-center"><div id="${id}" class="lattu">${lattuSvg()}</div></div>`);
      if (layer.props.state === "spinning") {
        const cycles = Math.min(20, Math.max(4, Math.floor((durationSec - 0.3) / 0.32)));
        for (let n = 0; n < cycles; n++) {
          const base = startSec + 0.25 + n * 0.32;
          tweens.push(tween({ target: id, from: { scaleX: n % 2 === 0 ? 1 : 0.72, rotation: n % 2 === 0 ? -8 : 8 }, to: { scaleX: n % 2 === 0 ? 0.72 : 1, rotation: n % 2 === 0 ? 8 : -8 }, at: base, duration: 0.16, ease: "power2.inOut" }));
        }
      } else {
        tweens.push(tween({ target: id, from: { rotation: 0, y: -20, opacity: 0 }, to: { rotation: 16, y: 0, opacity: 1 }, at, duration: 0.7, ease: "power3.out" }));
      }
    } else if (layer.component === "diagram.orbit@1") {
      const showPull = layer.props.showPull === true;
      const showSide = layer.props.showSideways === true;
      chunks.push(`<div class="slot-center"><div class="orbit">
        <div class="ring"></div>
        <div id="${id}-earth" class="earth"><span>Earth</span></div>
        <div id="${id}-arm" class="arm">${showSide ? `<i id="${id}-side" class="side">sideways</i>` : ""}<div id="${id}-moon" class="moon"><span>Moon</span></div></div>
        ${showPull ? `<b id="${id}-pull" class="pull">pull</b>` : ""}
      </div></div>`);
      tweens.push(tween({ target: `${id}-earth`, from: { scale: 0.7, opacity: 0 }, to: { scale: 1, opacity: 1 }, at, duration: 0.45, ease: "back.out" }));
      const sweep = showSide ? 150 : 24;
      tweens.push(tween({ target: `${id}-arm`, from: { rotation: -18 }, to: { rotation: -18 + sweep }, at: startSec + 0.2, duration: Math.max(2.4, sweep / 28), ease: "none" }));
      tweens.push(tween({ target: `${id}-moon`, from: { rotation: 18 }, to: { rotation: 18 - sweep }, at: startSec + 0.2, duration: Math.max(2.4, sweep / 28), ease: "none" }));
      if (showPull) {
        tweens.push(tween({ target: `${id}-pull`, from: { scaleX: 0, opacity: 0 }, to: { scaleX: 1, opacity: 1 }, at: startSec + 0.55, duration: 0.4, ease: "power2.out" }));
      }
      if (showSide) {
        tweens.push(tween({ target: `${id}-side`, from: { scaleX: 0, opacity: 0 }, to: { scaleX: 1, opacity: 1 }, at: startSec + 0.9, duration: 0.35, ease: "power2.out" }));
      }
    } else if (layer.component === "diagram.compare@1") {
      chunks.push(`<div class="slot-center"><div class="compare">
        <div id="${id}-l" class="card card-ink"><small>${escapeHtml(String(layer.props.leftLabel))}</small><strong>${escapeHtml(String(layer.props.left))}</strong></div>
        <div id="${id}-r" class="card card-moon"><small>${escapeHtml(String(layer.props.rightLabel))}</small><strong>${escapeHtml(String(layer.props.right))}</strong></div>
      </div></div>`);
      tweens.push(tween({ target: `${id}-l`, from: { y: 30, opacity: 0 }, to: { y: 0, opacity: 1 }, at, duration: 0.45, ease: "power3.out" }));
      tweens.push(tween({ target: `${id}-r`, from: { y: 30, opacity: 0 }, to: { y: 0, opacity: 1 }, at: at + 0.18, duration: 0.45, ease: "power3.out" }));
    } else if (layer.component === "text.bullets@1") {
      const items = Array.isArray(layer.props.items) ? layer.props.items.filter((item): item is string => typeof item === "string") : [];
      const rows = items.map((item, n) => `<li id="${id}-${n}"><em>0${n + 1}</em><span>${escapeHtml(item)}</span></li>`).join("");
      chunks.push(`<div class="slot-center"><ol class="bullets">${rows}</ol></div>`);
      items.forEach((_, n) => {
        tweens.push(tween({ target: `${id}-${n}`, from: { y: 20, opacity: 0 }, to: { y: 0, opacity: 1 }, at: at + n * 0.28, duration: 0.4, ease: "power3.out" }));
      });
    }
  }
  return { html: chunks.join("\n"), tweens };
}

function linesOf(words: TimedWord[]): TimedWord[][] {
  const lines: TimedWord[][] = [];
  let line: TimedWord[] = [];
  let width = 0;
  for (const word of words) {
    const add = (width === 0 ? 0 : 1) + word.text.length;
    if (width > 0 && width + add > 26) {
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(word);
    width += (width === 0 ? 0 : 1) + word.text.length;
  }
  if (line.length) lines.push(line);
  return lines;
}

function captionPages(line: TimedLine): { html: string; tweens: Tween[] } {
  const lines = linesOf(line.words);
  const pages: TimedWord[][][] = [];
  for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));

  const html: string[] = [];
  const tweens: Tween[] = [];
  pages.forEach((rows, p) => {
    const flat = rows.flat();
    const start = line.startMs + (flat[0]?.startMs ?? 0);
    const end = line.startMs + (flat[flat.length - 1]?.endMs ?? line.durationMs);
    let wordIndex = 0;
    const body = rows.map((words) => {
      const spans = words.map((word) => {
        const n = wordIndex;
        wordIndex += 1;
        const id = assertSafeId(`cap-${line.sceneId}-${line.lineId}-p${p}w${n}`);
        const at = (line.startMs + word.startMs) / 1000;
        const dur = Math.max(0.16, (word.endMs - word.startMs) / 1000);
        tweens.push(tween({ target: id, from: { opacity: 0.4 }, to: { opacity: 1 }, at, duration: 0.06, ease: "power2.out" }));
        tweens.push(tween({ target: id, from: { opacity: 1 }, to: { opacity: 0.4 }, at: at + Math.max(0.08, dur - 0.06), duration: 0.06, ease: "power2.out" }));
        return `<span id="${id}" class="word">${escapeHtml(word.text)} </span>`;
      }).join("");
      return `<p class="cap-line">${spans}</p>`;
    }).join("");
    const capId = assertSafeId(`caps-${line.sceneId}-${line.lineId}-${p}`);
    html.push(`<div id="${capId}" class="cap clip" data-start="${(start / 1000).toFixed(3)}" data-duration="${Math.max(0.2, (end - start) / 1000).toFixed(3)}" data-track-index="3">${body}</div>`);
  });
  return { html: html.join("\n"), tweens };
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: ${ink.paper}; }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${ink.paper}; }
  .wash { position: absolute; inset: 0; background:
    radial-gradient(ellipse at 18% 8%, rgba(242,159,5,.28), transparent 46%),
    radial-gradient(ellipse at 90% 24%, rgba(14,156,143,.16), transparent 40%);
  }
  .clip { position: absolute; }
  .scene { inset: 0; }
  .slot-top { position: absolute; left: 100px; right: 140px; top: 280px; }
  .slot-title { position: absolute; left: 100px; right: 140px; top: 370px; }
  .slot-hero { position: absolute; left: 80px; right: 140px; top: 640px; }
  .slot-center { position: absolute; left: 80px; right: 140px; top: 540px; height: 760px; }
  .slot-bottom { position: absolute; left: 100px; right: 140px; top: 1220px; }
  .kicker { margin: 0; font-family: Kalam, sans-serif; font-size: 58px; color: ${ink.teal}; }
  .title { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; line-height: 0.96; color: ${ink.ink}; letter-spacing: -0.03em; }
  .underline { width: 180px; height: 10px; margin-top: 18px; border-radius: 99px; background: ${ink.moon}; transform-origin: 0 50%; }
  .slam { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 168px; letter-spacing: -0.04em; color: ${ink.ink}; line-height: 0.9; }
  .note { margin: 0; font-family: Caveat, cursive; font-size: 72px; color: ${ink.saffron}; }
  .lattu { width: 460px; height: 540px; margin: 20px auto 0; transform-origin: 50% 62%; }
  .lattu svg { width: 100%; height: 100%; }
  .orbit { position: absolute; inset: 0; }
  .ring { position: absolute; left: 50%; top: 48%; width: 540px; height: 360px; margin: -180px 0 0 -270px; border: 4px dashed rgba(11,124,114,.45); border-radius: 50%; }
  .earth, .moon { border-radius: 50%; display: grid; place-items: center; color: ${ink.paper}; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; }
  .earth { position: absolute; left: 50%; top: 48%; width: 170px; height: 170px; margin: -85px 0 0 -85px; background: ${ink.earth}; font-size: 28px; }
  .arm { position: absolute; left: 50%; top: 48%; width: 270px; height: 92px; margin-top: -46px; transform-origin: 0 50%; }
  .moon { position: absolute; right: 0; top: 4px; width: 92px; height: 92px; background: ${ink.moon}; color: ${ink.ink}; font-size: 20px; }
  .pull { position: absolute; left: 50%; top: 62%; margin-left: -70px; font-family: Caveat, cursive; font-size: 54px; color: ${ink.saffron}; transform-origin: 0 50%; }
  .side { position: absolute; right: 0; top: -52px; width: 160px; text-align: center; font-style: normal; font-family: Caveat, cursive; font-size: 40px; color: ${ink.teal}; transform-origin: 50% 100%; }
  .compare { display: flex; gap: 28px; height: 100%; align-items: center; }
  .card { flex: 1; border-radius: 28px; min-height: 340px; padding: 36px 28px; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; }
  .card small { font-family: Caveat, cursive; font-size: 42px; }
  .card strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 54px; line-height: 0.95; letter-spacing: -0.03em; }
  .card-ink { background: ${ink.ink}; color: ${ink.paper}; }
  .card-moon { background: ${ink.moon}; color: ${ink.ink}; }
  .bullets { list-style: none; margin: 40px 0 0; padding: 0; display: flex; flex-direction: column; gap: 28px; }
  .bullets li { display: flex; gap: 22px; align-items: baseline; }
  .bullets em { font-style: normal; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: 48px; color: ${ink.teal}; }
  .bullets span { font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 48px; color: ${ink.ink}; }
  .cap { left: 90px; width: 860px; top: 1420px; text-align: center; }
  .cap p { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 40px; line-height: 1.28; color: ${ink.ink}; text-shadow: -3px 0 0 ${ink.paper}, 3px 0 0 ${ink.paper}, 0 -3px 0 ${ink.paper}, 0 3px 0 ${ink.paper}; }
  .word { display: inline; }
  .word.on { color: ${ink.teal}; }
`;

function fontFace(): string {
  return `
    @font-face { font-family: "Bricolage Grotesque"; src: url("assets/fonts/bricolage.woff2") format("woff2"); font-weight: 700; font-display: block; }
    @font-face { font-family: Kalam; src: url("assets/fonts/kalam-deva.woff2") format("woff2"); font-weight: 400; font-display: block; unicode-range: U+0900-097F; }
    @font-face { font-family: Kalam; src: url("assets/fonts/kalam-latin.woff2") format("woff2"); font-weight: 400; font-display: block; }
    @font-face { font-family: Caveat; src: url("assets/fonts/caveat.woff2") format("woff2"); font-weight: 600; font-display: block; }
  `;
}

export function compileHtml(opts: { plan: Plan; timeline: Timeline }): string {
  const tweens: Tween[] = [];
  const scenes = opts.plan.scenes.map((scene) => {
    const slot = opts.timeline.scenes.find((item) => item.id === scene.id);
    const start = slot?.startMs ?? 0;
    const duration = slot?.durationMs ?? 1000;
    const rendered = layerHtml(opts.plan, opts.plan.scenes.indexOf(scene), start / 1000, duration / 1000);
    tweens.push(...rendered.tweens);
    return `<section id="${assertSafeId(`scene-${scene.id}`)}" class="clip scene" data-start="${(start / 1000).toFixed(3)}" data-duration="${(duration / 1000).toFixed(3)}" data-track-index="1">${rendered.html}</section>`;
  });

  const captions = opts.timeline.lines.map((line) => {
    const page = captionPages(line);
    tweens.push(...page.tweens);
    return page.html;
  });

  const audios = opts.timeline.lines.map((line) => {
    const id = assertSafeId(`vo-${line.sceneId}-${line.lineId}`);
    return `<audio id="${id}" src="${line.audioFile}" data-start="${(line.startMs / 1000).toFixed(3)}" data-duration="${(line.durationMs / 1000).toFixed(3)}" data-track-index="4" data-volume="1"></audio>`;
  });

  const duration = (opts.timeline.durationMs / 1000).toFixed(3);
  const script = `const tweens = ${JSON.stringify(tweens)};
const tl = gsap.timeline({ paused: true });
for (const tw of tweens) {
  tl.fromTo("#" + tw.target, tw.from, Object.assign({}, tw.to, { duration: tw.duration, ease: tw.ease === "back.out" ? "back.out(1.4)" : tw.ease }), tw.at);
}
window.__timelines = window.__timelines || {};
window.__timelines["main"] = tl;`;

  const html = `<!doctype html>
<html lang="en" data-resolution="portrait">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1080, height=1920" />
  <title>${escapeHtml(opts.plan.title)}</title>
  <script src="assets/gsap.min.js"></script>
  <style>${fontFace()}${CSS}</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
    <div class="wash"></div>
    ${scenes.join("\n")}
    ${captions.join("\n")}
    ${audios.join("\n")}
  </div>
  <script>${script}</script>
</body>
</html>`;

  return html;
}

export function compileProject(opts: { plan: Plan; timeline: Timeline; outDir: string }): void {
  const dir = opts.outDir;
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  copyFileSync(resolve(ROOT, "node_modules/gsap/dist/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2"), resolve(dir, "assets/fonts/bricolage.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/kalam/files/kalam-devanagari-700-normal.woff2"), resolve(dir, "assets/fonts/kalam-deva.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/kalam/files/kalam-latin-700-normal.woff2"), resolve(dir, "assets/fonts/kalam-latin.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2"), resolve(dir, "assets/fonts/caveat.woff2"));

  const html = compileHtml(opts);
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  }, null, 2));
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({
    name: "leela-render",
    private: true,
    type: "module",
    scripts: {
      check: "npx --yes hyperframes@0.8.176 check",
      render: "npx --yes hyperframes@0.8.176 render",
    },
  }, null, 2));
  writeFileSync(resolve(dir, "timeline.json"), JSON.stringify(opts.timeline, null, 2));
}
