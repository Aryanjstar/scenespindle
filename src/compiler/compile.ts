import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Format, Plan } from "../contracts/plan";
import type { TraceState } from "../trace/states";
import { chalkAndChai as ink } from "../catalog/style";
import { assertSafeId, escapeHtml } from "./escape";
import { cleanLook, mouthTrack, stageModule, STAGE_ACTIONS, STAGE_LOOKS, STAGE_SETS, STAGE_SHOTS, type StageScene } from "./stage";

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

export type Layout = {
  w: number;
  h: number;
  resolution: "portrait" | "landscape" | "square";
  slots: Record<"top" | "title" | "hero" | "center" | "bottom", { left: number; right: number; top: number; height?: number }>;
  cap: { left: number; width: number; top: number; size: number; chars: number };
  type: number;
};

export const LAYOUTS: Record<Format, Layout> = {
  "9x16": {
    w: 1080, h: 1920, resolution: "portrait",
    slots: {
      top: { left: 100, right: 140, top: 280 },
      title: { left: 100, right: 140, top: 370 },
      hero: { left: 80, right: 140, top: 640 },
      center: { left: 80, right: 140, top: 540, height: 760 },
      bottom: { left: 100, right: 140, top: 1220 },
    },
    cap: { left: 80, width: 920, top: 1360, size: 58, chars: 22 },
    type: 1,
  },
  "1x1": {
    w: 1080, h: 1080, resolution: "square",
    slots: {
      top: { left: 90, right: 90, top: 80 },
      title: { left: 90, right: 90, top: 150 },
      hero: { left: 80, right: 90, top: 290 },
      center: { left: 80, right: 90, top: 300, height: 430 },
      bottom: { left: 90, right: 90, top: 690 },
      },
    cap: { left: 60, width: 960, top: 820, size: 50, chars: 30 },
    type: 0.78,
  },
  "16x9": {
    w: 1920, h: 1080, resolution: "landscape",
    slots: {
      top: { left: 120, right: 1020, top: 150 },
      title: { left: 120, right: 1020, top: 230 },
      hero: { left: 120, right: 1020, top: 430 },
      center: { left: 1000, right: 120, top: 150, height: 620 },
      bottom: { left: 120, right: 1020, top: 650 },
    },
    cap: { left: 160, width: 1600, top: 860, size: 54, chars: 40 },
    type: 0.9,
  },
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

function layerHtml(plan: Plan, sceneIndex: number, startSec: number, durationSec: number, layout: Layout, trace?: CompileTrace, timed: TimedLine[] = [], images: Record<string, string> = {}): { html: string; tweens: Tween[] } {
  const scene = plan.scenes[sceneIndex];
  if (!scene) return { html: "", tweens: [] };
  const tweens: Tween[] = [];
  const chunks: string[] = [];
  const words = plan.language === "hi" ? { earth: "धरती", moon: "चाँद", pull: "खिंचाव", sideways: "आगे की चाल" } : { earth: "Earth", moon: "Moon", pull: "pull", sideways: "sideways" };
  for (const layer of scene.layers) {
    const id = assertSafeId(`${scene.id}-${layer.id}`);
    const at = startSec + 0.12;
    if (layer.component === "text.kicker@1") {
      chunks.push(`<div class="slot-top"><p id="${id}" class="kicker">${escapeHtml(String(layer.props.text))}</p></div>`);
      tweens.push(tween({ target: id, from: { y: 18, opacity: 0 }, to: { y: 0, opacity: 1 }, at, duration: 0.45, ease: "power3.out" }));
    } else if (layer.component === "text.title@1") {
      const slot = layer.slot === "hero" ? "slot-hero" : "slot-title";
      const size = Math.round((String(layer.props.text).length > 22 ? 68 : 92) * layout.type);
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
        <div id="${id}-earth" class="earth"><span>${words.earth}</span></div>
        <div id="${id}-arm" class="arm">${showSide ? `<i id="${id}-side" class="side">${words.sideways}</i>` : ""}<div id="${id}-moon" class="moon"><span>${words.moon}</span></div></div>
        ${showPull ? `<b id="${id}-pull" class="pull">${words.pull}</b>` : ""}
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
    } else if ((layer.component === "trace.array@1" || layer.component === "trace.stack@1") && trace?.states.length) {
      const from = Math.min(Number(layer.props.from) || 0, trace.states.length - 1);
      const to = Math.min(Math.max(Number(layer.props.to) || 0, from), trace.states.length - 1);
      const shown = trace.states.slice(from, to + 1);
      const span = Math.max(0.6, durationSec - 0.5);
      const each = span / shown.length;
      const frames = shown.map((state, k) => {
        const fid = assertSafeId(`${id}-k${k}`);
        const at0 = startSec + 0.2 + k * each;
        tweens.push(tween({ target: fid, from: { opacity: 0, y: 10 }, to: { opacity: 1, y: 0 }, at: at0, duration: 0.18, ease: "power2.out" }));
        if (k < shown.length - 1) tweens.push(tween({ target: fid, from: { opacity: 1 }, to: { opacity: 0 }, at: at0 + each - 0.04, duration: 0.12, ease: "none" }));
        return `<div id="${fid}" class="trace-frame" style="opacity:0">${layer.component === "trace.array@1" ? arrayState(state) : stackState(state)}</div>`;
      });
      chunks.push(`<div class="slot-center"><div class="trace">${frames.join("")}</div></div>`);
    } else if (layer.component === "image.still@1") {
      // The plan holds only an asset id; trusted code resolved it to a copied file name.
      const assetId = typeof layer.props.assetId === "string" ? layer.props.assetId : "";
      const file = assetId ? images[assetId] : undefined;
      const inner = file
        ? `<img id="${id}" class="still" src="${file}" alt="" />`
        : `<div id="${id}" class="still still-missing"><span>${escapeHtml(String(layer.props.prompt ?? "").slice(0, 140))}</span></div>`;
      chunks.push(`<div class="slot-full">${inner}<div class="still-shade"></div></div>`);
      const drift = sceneIndex % 2 === 0 ? -24 : 24;
      tweens.push(tween({ target: id, from: { scale: 1.02, x: 0, opacity: 0 }, to: { scale: 1.02, x: 0, opacity: 1 }, at: startSec, duration: 0.35, ease: "power2.out" }));
      tweens.push(tween({ target: id, from: { scale: 1.02, x: 0 }, to: { scale: 1.12, x: drift }, at: startSec + 0.35, duration: Math.max(0.5, durationSec - 0.35), ease: "none" }));
    } else if (layer.component === "kinetic.words@1" && plan.mode === "lyrics") {
      const blocks = timed.map((line, li) => {
        const words = line.words.length ? line.words : [{ text: line.text, startMs: 0, endMs: line.durationMs }];
        const spans = words.map((word, n) => {
          const wid = assertSafeId(`${id}-l${li}w${n}`);
          const at0 = (line.startMs + word.startMs) / 1000;
          const until = (line.startMs + (words[n + 1]?.startMs ?? word.endMs)) / 1000;
          tweens.push(tween({ target: wid, from: { opacity: 0.4, scale: 0.92 }, to: { opacity: 1, scale: 1.08 }, at: at0, duration: 0.08, ease: "power2.out" }));
          tweens.push(tween({ target: wid, from: { opacity: 1, scale: 1.08 }, to: { opacity: 0.72, scale: 1 }, at: Math.max(at0 + 0.08, until - 0.02), duration: 0.06, ease: "none" }));
          return `<span id="${wid}" class="lyric-word">${escapeHtml(word.text)}</span>`;
        }).join(" ");
        const lid = assertSafeId(`${id}-line${li}`);
        const start = line.startMs / 1000;
        const end = (line.startMs + line.durationMs) / 1000;
        tweens.push(tween({ target: lid, from: { opacity: 0, y: 16 }, to: { opacity: 1, y: 0 }, at: Math.max(0, start - 0.04), duration: 0.12, ease: "power2.out" }));
        tweens.push(tween({ target: lid, from: { opacity: 1 }, to: { opacity: 0 }, at: Math.max(start + 0.2, end - 0.08), duration: 0.1, ease: "none" }));
        return `<p id="${lid}" class="lyric-line" style="opacity:0">${spans}</p>`;
      }).join("");
      chunks.push(`<div class="slot-hero lyric">${blocks}</div>`);
    } else if (layer.component === "kinetic.words@1") {
      // One word at a time, on the measured word times. Long words get the accent.
      const words = timed.flatMap((line) => line.words.map((word) => ({ ...word, startMs: line.startMs + word.startMs, endMs: line.startMs + word.endMs })));
      const spans = words.map((word, n) => {
        const wid = assertSafeId(`${id}-w${n}`);
        const at0 = word.startMs / 1000;
        const until = (words[n + 1]?.startMs ?? word.endMs + 400) / 1000;
        const strong = word.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 7;
        tweens.push(tween({ target: wid, from: { opacity: 0, scale: 0.86, y: 18 }, to: { opacity: 1, scale: 1, y: 0 }, at: at0, duration: 0.14, ease: "power3.out" }));
        tweens.push(tween({ target: wid, from: { opacity: 1 }, to: { opacity: 0 }, at: Math.max(at0 + 0.12, until - 0.02), duration: 0.06, ease: "none" }));
        return `<span id="${wid}" class="kword${strong ? " strong" : ""}" style="opacity:0">${escapeHtml(word.text.replace(/[,;:]$/, ""))}</span>`;
      }).join("");
      chunks.push(`<div class="slot-hero kinetic">${spans}</div>`);
    } else if (layer.component === "audio.pulse@1") {
      const bars = Array.from({ length: 24 }, (_, n) => `<i id="${assertSafeId(`${id}-b${n}`)}" style="height:${18 + ((n * 37) % 50)}px"></i>`).join("");
      chunks.push(`<div class="slot-bottom pulse">${bars}</div>`);
      const onsets = timed.flatMap((line) => line.words.map((word) => (line.startMs + word.startMs) / 1000));
      onsets.forEach((t, k) => {
        const bar = assertSafeId(`${id}-b${(k * 7) % 24}`);
        tweens.push(tween({ target: bar, from: { scaleY: 1 }, to: { scaleY: 2.6 }, at: t, duration: 0.08, ease: "power2.out" }));
        tweens.push(tween({ target: bar, from: { scaleY: 2.6 }, to: { scaleY: 1 }, at: t + 0.1, duration: 0.22, ease: "power2.out" }));
      });
    } else if (layer.component === "code.listing@1" && trace?.code) {
      const highlight = Number(layer.props.highlight) || 0;
      const lines = trace.code.split("\n").slice(0, 16).map((text, n) => `<li class="${n + 1 === highlight ? "hl" : ""}"><b>${n + 1}</b><span>${escapeHtml(text.replaceAll("\t", "  ")) || "&nbsp;"}</span></li>`).join("");
      chunks.push(`<div class="slot-center"><ol id="${id}" class="code">${lines}</ol></div>`);
      tweens.push(tween({ target: id, from: { y: 24, opacity: 0 }, to: { y: 0, opacity: 1 }, at, duration: 0.45, ease: "power3.out" }));
    }
  }
  return { html: chunks.join("\n"), tweens };
}

export type CompileTrace = { states: TraceState[]; code?: string };

function arrayState(state: TraceState): string {
  if (!state.array) return stackState(state);
  const pointerAt = new Map<number, string[]>();
  for (const [name, index] of state.pointers) pointerAt.set(index, [...(pointerAt.get(index) ?? []), name]);
  const lo = state.pointers.find(([name]) => /^(lo|low|left|l|start)$/.test(name))?.[1];
  const hi = state.pointers.find(([name]) => /^(hi|high|right|r|end)$/.test(name))?.[1];
  const focus = state.pointers.find(([name]) => /^(mid|i|pivot|p)$/.test(name))?.[1];
  const cells = state.array.map((value, index) => {
    const out = (lo !== undefined && index < lo) || (hi !== undefined && index > hi);
    const cls = ["cell", out ? "out" : "", index === focus ? "focus" : ""].filter(Boolean).join(" ");
    const names = pointerAt.get(index)?.join(" ") ?? "";
    return `<div class="${cls}"><span>${escapeHtml(String(value))}</span><i>${index}</i><em>${escapeHtml(names)}</em></div>`;
  }).join("");
  const vars = state.scalars.filter(([name]) => name !== state.arrayName).map(([name, value]) => `<span><b>${escapeHtml(name)}</b> ${escapeHtml(String(value))}</span>`).join("");
  return `<div class="cells">${cells}</div><div class="vars">${vars}</div>`;
}

function stackState(state: TraceState): string {
  const frames = state.stack.map((label, n) => `<li class="${n === state.stack.length - 1 ? "top" : ""}">${escapeHtml(label)}</li>`).join("");
  const vars = state.scalars.map(([name, value]) => `<span><b>${escapeHtml(name)}</b> ${escapeHtml(String(value))}</span>`).join("");
  return `<ol class="stack">${frames}</ol><div class="vars">${vars}</div>`;
}

function linesOf(words: TimedWord[], chars = 22): TimedWord[][] {
  const lines: TimedWord[][] = [];
  let line: TimedWord[] = [];
  let width = 0;
  for (const word of words) {
    const add = (width === 0 ? 0 : 1) + word.text.length;
    if (width > 0 && width + add > chars) {
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(word);
    width += (width === 0 ? 0 : 1) + word.text.length;
  }
  if (line.length) lines.push(line);
  // Never leave one short word alone on the last caption row; borrow from the row above.
  if (lines.length > 1 && lines[lines.length - 1].length === 1) {
    const prev = lines[lines.length - 2];
    if (prev.length > 2) lines[lines.length - 1].unshift(prev.pop()!);
  }
  // A lone last row on its own page reads as an orphan; fold it into the previous page when it fits.
  if (lines.length % 2 === 1 && lines.length > 1) {
    const last = lines[lines.length - 1];
    const prev = lines[lines.length - 2];
    const width = [...prev, ...last].reduce((sum, word) => sum + word.text.length + 1, 0);
    if (width <= chars + 8) { lines.splice(lines.length - 2, 2, [...prev, ...last]); }
  }
  return lines;
}

function captionPages(line: TimedLine, chars: number): { html: string; tweens: Tween[] } {
  const lines = linesOf(line.words, chars);
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
        tweens.push(tween({ target: id, from: { scale: 1 }, to: { scale: 1.06 }, at, duration: 0.06, ease: "power2.out" }));
        tweens.push(tween({ target: id, from: { scale: 1.06 }, to: { scale: 1 }, at: at + Math.max(0.08, dur - 0.06), duration: 0.06, ease: "power2.out" }));
        return `<span id="${id}" class="word">${escapeHtml(word.text)} </span>`;
      }).join("");
      return `<p class="cap-line">${spans}</p>`;
    }).join("");
    const capId = assertSafeId(`caps-${line.sceneId}-${line.lineId}-${p}`);
    html.push(`<div id="${capId}" class="cap clip" data-start="${(start / 1000).toFixed(3)}" data-duration="${Math.max(0.2, (end - start) / 1000).toFixed(3)}" data-track-index="3">${body}</div>`);
  });
  return { html: html.join("\n"), tweens };
}

function css(L: Layout): string {
  const slot = (name: keyof Layout["slots"]) => { const v = L.slots[name]; return `left: ${v.left}px; right: ${v.right}px; top: ${v.top}px;${v.height ? ` height: ${v.height}px;` : ""}`; };
  return `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${L.w}px; height: ${L.h}px; overflow: hidden; background: ${ink.paper}; }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${ink.paper}; }
  .wash { position: absolute; inset: 0; background:
    radial-gradient(ellipse at 18% 8%, rgba(242,159,5,.28), transparent 46%),
    radial-gradient(ellipse at 90% 24%, rgba(14,156,143,.16), transparent 40%);
  }
  .clip { position: absolute; }
  .scene { inset: 0; }
  .slot-top { position: absolute; ${slot("top")} }
  .slot-title { position: absolute; ${slot("title")} }
  .slot-hero { position: absolute; ${slot("hero")} }
  .slot-center { position: absolute; ${slot("center")} }
  .slot-bottom { position: absolute; ${slot("bottom")} }
  .kicker { margin: 0; font-family: Kalam, sans-serif; font-size: 58px; color: ${ink.teal}; }
  .title { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; line-height: 0.96; color: ${ink.ink}; letter-spacing: -0.03em; }
  .underline { width: 180px; height: 10px; margin-top: 18px; border-radius: 99px; background: ${ink.moon}; transform-origin: 0 50%; }
  .slam { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: ${Math.round(168 * L.type)}px; letter-spacing: -0.04em; color: ${ink.ink}; line-height: 0.9; }
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
  .cap { left: ${L.cap.left}px; width: ${L.cap.width}px; top: ${L.cap.top}px; text-align: center; }
  .cap p { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: ${L.cap.size}px; line-height: 1.2; color: ${ink.ink}; text-shadow: -3px 0 0 ${ink.paper}, 3px 0 0 ${ink.paper}, 0 -3px 0 ${ink.paper}, 0 3px 0 ${ink.paper}; }
  .word { display: inline; opacity: 0.62; }
  .word.on { color: ${ink.teal}; }
  .slot-full { position: absolute; inset: 0; overflow: hidden; background: ${ink.ink}; }
  .still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 45%; }
  .still-missing { display: grid; place-items: center; padding: 120px; background: repeating-linear-gradient(45deg, #efe6d4 0 24px, #f6efe2 24px 48px); }
  .still-missing span { font-family: "Bricolage Grotesque", sans-serif; font-size: ${Math.round(40 * L.type)}px; color: ${ink.ink}; text-align: center; opacity: .7; }
  .still-shade { position: absolute; left: 0; right: 0; bottom: 0; height: 38%; background: linear-gradient(to top, rgba(251,244,232,.92), rgba(251,244,232,0)); }
  .kinetic { position: absolute; display: grid; place-items: center; height: ${Math.round(L.h * 0.3)}px; }
  .kword { grid-area: 1 / 1; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: ${Math.round(150 * L.type)}px; line-height: 1; letter-spacing: -0.03em; color: ${ink.ink}; text-align: center; }
  .kword.strong { color: ${ink.saffron}; }
  #stage { position: absolute; inset: 0; width: ${L.w}px; height: ${L.h}px; z-index: 1; }
  .scene, .cap { z-index: 2; }
  .pulse { display: flex; gap: 10px; align-items: center; justify-content: center; height: 140px; }
  .pulse i { display: block; width: 14px; border-radius: 7px; background: ${ink.teal}; opacity: .7; transform-origin: 50% 50%; }
  .trace { position: relative; width: 100%; height: 100%; }
  .trace-frame { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
  .cells { display: flex; flex-wrap: nowrap; gap: 10px; justify-content: center; }
  .cell { position: relative; flex: 1 1 0; min-width: 0; max-width: 112px; height: 120px; border-radius: 18px; background: #fff; border: 4px solid ${ink.ink}; display: grid; place-items: center; }
  .cell span { font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 40px; color: ${ink.ink}; }
  .cell i { position: absolute; top: -34px; font-style: normal; font-family: Mono, monospace; font-size: 22px; color: ${ink.ink}; opacity: .55; }
  .cell em { position: absolute; bottom: -46px; font-style: normal; font-family: Caveat, cursive; font-size: 38px; color: ${ink.saffron}; white-space: nowrap; }
  .cell.out { opacity: .28; }
  .cell.focus { background: ${ink.moon}; }
  .vars { display: flex; flex-wrap: wrap; gap: 14px 28px; justify-content: center; margin-top: 24px; font-family: Mono, monospace; font-size: 34px; color: ${ink.ink}; }
  .vars b { color: ${ink.teal}; font-weight: 500; }
  .stack { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column-reverse; gap: 12px; align-items: center; }
  .stack li { min-width: 60%; padding: 18px 26px; border-radius: 16px; border: 3px solid ${ink.ink}; background: #fff; font-family: Mono, monospace; font-size: 32px; color: ${ink.ink}; text-align: center; }
  .stack li.top { background: ${ink.moon}; }
  .code, .vars, .stack li, .cell i { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
  .code { list-style: none; margin: 0; padding: 28px 24px; border-radius: 24px; background: ${ink.ink}; color: ${ink.paper}; font-family: Mono, monospace; font-size: ${Math.round(30 * L.type)}px; line-height: 1.45; }
  .code li { display: flex; gap: 22px; white-space: pre; }
  .code b { width: 34px; text-align: right; opacity: .4; font-weight: 400; }
  .code li.hl { background: rgba(242,159,5,.28); border-radius: 8px; }
`;
}

const ILLUSTRATED_MODES = new Set(["story", "cartoon"]);

/** Over pictures, words need their own contrast: white type with a thick ink outline, no boxes. The title sits in the top band and captions sit below the feet. */
function illustratedCss(L: Layout): string {
  const o = (w: number) => [[-w, 0], [w, 0], [0, -w], [0, w], [-w, -w], [w, w], [-w, w], [w, -w]].map(([x, y]) => `${x}px ${y}px 0 ${ink.ink}`).join(", ");
  const portrait = L.h > L.w;
  const capTop = Math.round(L.h * (portrait ? 0.86 : 0.84));
  const kickerTop = portrait ? 64 : 36;
  return `
  .slot-top { top: ${kickerTop}px; left: 56px; right: 56px; }
  .cap { top: ${capTop}px; left: 56px; width: ${L.w - 112}px; }
  .cap p { color: #ffffff; text-shadow: ${o(4)}, 0 6px 18px rgba(0,0,0,.35); font-size: ${Math.round((portrait ? 46 : 40) * L.type)}px; }
  .word { opacity: 0.78; }
  .word.on, .cap p .word[style*="opacity: 1"] { color: #ffd166; }
  .kicker { display: inline-block; padding: 4px 14px 8px; border-radius: 12px; background: ${ink.moon}; color: ${ink.ink}; border: 3px solid ${ink.ink}; font-size: ${portrait ? 34 : 28}px; transform: rotate(-2deg); box-shadow: 4px 4px 0 ${ink.ink}; }
  .still-shade { height: 22%; background: linear-gradient(to top, rgba(20,16,28,.45), rgba(20,16,28,0)); }
`;
}

/** Explainer, Code Lab and Audio sit on a coloured night stage, not a blank cream page. */
function spokenCss(): string {
  return `
  html, body, #root { background: #1b2433; }
  .wash { background:
    radial-gradient(ellipse at 18% 0%, rgba(242,159,5,.32), transparent 44%),
    radial-gradient(ellipse at 88% 18%, rgba(14,156,143,.3), transparent 48%),
    #1b2433; }
  .kicker { color: #ffb020; }
  .title, .slam, .cap p, .kword, .word {
    color: #ffb020;
    font-weight: 800;
    text-shadow: -3px 0 0 #141820, 3px 0 0 #141820, 0 -3px 0 #141820, 0 3px 0 #141820, -3px -3px 0 #141820, 3px 3px 0 #141820, -3px 3px 0 #141820, 3px -3px 0 #141820;
  }
  .kword.strong { color: #ffb020; }
  .word { display: inline-block; opacity: 1; margin-right: 0.28em; transform-origin: 50% 70%; }
  .note { color: #ffb020; }
  .underline { background: #ffb020; }
  .cell { background: #fffaf3; }
  .bullets span, .bullets em { color: #fff4d2; }
  .code { background: #10151f; }
  `;
}

/** Code Lab sits on the night stage, but the code and the words use the paper theme so they stay readable. */
function codeLabCss(): string {
  const edge = [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]].map(([x, y]) => `${x}px ${y}px 0 #1d1a24`).join(", ");
  return `
  .code { background: #fff6e8; color: #1d1a24; border: 4px solid #1d1a24; box-shadow: 6px 6px 0 #1d1a24; }
  .code b { color: #7a7283; opacity: 1; }
  .code li.hl { background: #ffb020; color: #1d1a24; }
  .cell { background: #fff6e8; border-color: #1d1a24; }
  .cell span, .cell i, .vars, .stack li { color: #1d1a24; }
  .title, .slam, .cap p, .kword { color: #ffb020; text-shadow: ${edge}; }
  .kword.strong { color: #fff6e8; }
  `;
}

function lyricsCss(L: Layout): string {
  return `
  html, body, #root { background: #120d18; }
  .wash { background:
    radial-gradient(ellipse at 50% 42%, rgba(255, 95, 162, .28), transparent 42%),
    radial-gradient(ellipse at 50% 80%, rgba(61, 227, 245, .16), transparent 46%),
    #120d18; }
  .slot-hero.lyric { top: ${Math.round(L.h * 0.36)}px; left: 64px; right: 64px; height: auto; display: grid; place-items: center; }
  .slot-bottom { top: ${Math.round(L.h * 0.78)}px; }
  .lyric-line { margin: 0; grid-area: 1 / 1; text-align: center; max-width: 92%; }
  .lyric-word { display: inline-block; margin: 0 0.14em; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: ${Math.round(72 * L.type)}px; line-height: 1.15; color: #fff8ee; text-shadow: -3px 0 0 #120d18, 3px 0 0 #120d18, 0 -3px 0 #120d18, 0 3px 0 #120d18; }
  .pulse i { background: #ff5fa2; }
  .kicker { color: #fff8ee; }
  `;
}

export function performedScenes(plan: Plan, timeline: Timeline): StageScene[] {
  const scenes: StageScene[] = [];
  const castSize = Math.max(1, Math.min(3, plan.cast?.length ?? 2));
  plan.scenes.forEach((scene, index) => {
    const layer = scene.layers.find((item) => item.component === "stage.perform@1");
    if (!layer) return;
    const slot = timeline.scenes.find((item) => item.id === scene.id);
    const start = (slot?.startMs ?? 0) / 1000;
    const end = start + (slot?.durationMs ?? 1000) / 1000;
    const action = STAGE_ACTIONS.find((item) => item === layer.props.action) ?? "talk";
    const look = STAGE_LOOKS.find((item) => item === layer.props.look) ?? "storybook";
    const set = STAGE_SETS.find((item) => item === layer.props.set) ?? "bank";
    // Older plans have no shot: vary framing so beats do not all look the same.
    const shot = STAGE_SHOTS.find((item) => item === layer.props.shot) ?? (index === 0 ? "wide" : action === "talk" && index % 3 === 2 ? "close" : "medium");
    const raw = Array.isArray(layer.props.on) ? (layer.props.on as unknown[]) : null;
    const on = raw
      ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < castSize))].slice(0, 3)
      : Array.from({ length: layer.props.rigs === 2 ? Math.min(2, castSize) : 1 }, (_, i) => i);
    const speaker = Number.isInteger(layer.props.speaker) && (layer.props.speaker as number) >= -1 && (layer.props.speaker as number) < castSize ? (layer.props.speaker as number) : (on[0] ?? 0);
    scenes.push({ start, end, action, look, set, shot, on: on.length ? on : [0], speaker });
  });
  return scenes;
}

function fontFace(): string {
  return `
    @font-face { font-family: "Bricolage Grotesque"; src: url("assets/fonts/anek-deva.woff2") format("woff2"); font-weight: 700; font-display: block; unicode-range: U+0900-097F, U+1CD0-1CFF, U+200C-200D, U+A8E0-A8FF; }
    @font-face { font-family: "Bricolage Grotesque"; src: url("assets/fonts/bricolage.woff2") format("woff2"); font-weight: 700; font-display: block; }
    @font-face { font-family: Caveat; src: url("assets/fonts/kalam-deva.woff2") format("woff2"); font-weight: 600; font-display: block; unicode-range: U+0900-097F; }
    @font-face { font-family: Mono; src: url("assets/fonts/mono.woff2") format("woff2"); font-weight: 500; font-display: block; }
    @font-face { font-family: Kalam; src: url("assets/fonts/kalam-deva.woff2") format("woff2"); font-weight: 400; font-display: block; unicode-range: U+0900-097F; }
    @font-face { font-family: Kalam; src: url("assets/fonts/kalam-latin.woff2") format("woff2"); font-weight: 400; font-display: block; }
    @font-face { font-family: Caveat; src: url("assets/fonts/caveat.woff2") format("woff2"); font-weight: 600; font-display: block; }
  `;
}

export function compileProject(opts: { plan: Plan; timeline: Timeline; outDir: string; trace?: CompileTrace; images?: Record<string, string>; audioTrack?: string; stageVideo?: string }): void {
  const dir = opts.outDir;
  const layout = LAYOUTS[opts.plan.format] ?? LAYOUTS["9x16"];
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  copyFileSync(resolve(ROOT, "node_modules/gsap/dist/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2"), resolve(dir, "assets/fonts/bricolage.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/kalam/files/kalam-devanagari-700-normal.woff2"), resolve(dir, "assets/fonts/kalam-deva.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/kalam/files/kalam-latin-700-normal.woff2"), resolve(dir, "assets/fonts/kalam-latin.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2"), resolve(dir, "assets/fonts/caveat.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/anek-devanagari/files/anek-devanagari-devanagari-700-normal.woff2"), resolve(dir, "assets/fonts/anek-deva.woff2"));
  copyFileSync(resolve(ROOT, "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2"), resolve(dir, "assets/fonts/mono.woff2"));

  // Copy resolved stills in under fixed names; ids are validated hex, never paths from a plan.
  const images: Record<string, string> = {};
  for (const [assetId, source] of Object.entries(opts.images ?? {})) {
    if (!/^[a-f0-9]{24}$/.test(assetId)) continue;
    // Previews served by the studio point at the owner-checked asset route instead of copying.
    if (source === `/api/assets/${assetId}/file`) { images[assetId] = source; continue; }
    const name = `assets/img-${assetId}.png`;
    copyFileSync(source, resolve(dir, name));
    images[assetId] = name;
  }
  const tweens: Tween[] = [];
  const scenes = opts.plan.scenes.map((scene) => {
    const slot = opts.timeline.scenes.find((item) => item.id === scene.id);
    const start = slot?.startMs ?? 0;
    const duration = slot?.durationMs ?? 1000;
    const rendered = layerHtml(opts.plan, opts.plan.scenes.indexOf(scene), start / 1000, duration / 1000, layout, opts.trace, opts.timeline.lines.filter((line) => line.sceneId === scene.id), images);
    tweens.push(...rendered.tweens);
    return `<section id="${assertSafeId(`scene-${scene.id}`)}" class="clip scene" data-start="${(start / 1000).toFixed(3)}" data-duration="${(duration / 1000).toFixed(3)}" data-track-index="1">${rendered.html}</section>`;
  });

  // Audio films show the words themselves, so they skip the caption band.
  const captions = (opts.plan.mode === "audio" || opts.plan.mode === "lyrics" ? [] : opts.timeline.lines).map((line) => {
    const page = captionPages(line, layout.cap.chars);
    tweens.push(...page.tweens);
    return page.html;
  });

  // A song (lyric videos) is one continuous track; narration is one clip per line.
  const audios = opts.audioTrack ? [`<audio id="song" src="${opts.audioTrack}" data-start="0" data-duration="${(opts.timeline.durationMs / 1000).toFixed(3)}" data-track-index="4" data-volume="1"></audio>`] : opts.timeline.lines.map((line) => {
    const id = assertSafeId(`vo-${line.sceneId}-${line.lineId}`);
    return `<audio id="${id}" src="${line.audioFile}" data-start="${(line.startMs / 1000).toFixed(3)}" data-duration="${(line.durationMs / 1000).toFixed(3)}" data-track-index="4" data-volume="1"></audio>`;
  });

  const duration = (opts.timeline.durationMs / 1000).toFixed(3);
  const performed = performedScenes(opts.plan, opts.timeline);
  // Cinematic profile: the stage was rendered offline (Blender) and plays as a video layer.
  const stageVideo = performed.length && opts.stageVideo ? "assets/stage.mp4" : "";
  if (stageVideo) copyFileSync(opts.stageVideo!, resolve(dir, stageVideo));
  if (performed.length && !stageVideo) {
    copyFileSync(resolve(ROOT, "node_modules/three/build/three.module.js"), resolve(dir, "assets/three.module.js"));
    copyFileSync(resolve(ROOT, "node_modules/three/build/three.core.js"), resolve(dir, "assets/three.core.js"));
    writeFileSync(resolve(dir, "assets/stage.mjs"), stageModule({ width: layout.w, height: layout.h, scenes: performed, mouth: mouthTrack(opts.timeline.lines), cast: (opts.plan.cast ?? []).map((member, i) => cleanLook(member.look, i)) }));
  }
  const script = `const tweens = ${JSON.stringify(tweens)};
const tl = gsap.timeline({ paused: true });
const seen = new Set();
for (const tw of tweens) {
  // Only an element's first tween sets its starting state; later ones must not jump ahead.
  const first = !seen.has(tw.target);
  seen.add(tw.target);
  tl.fromTo("#" + tw.target, tw.from, Object.assign({}, tw.to, { duration: tw.duration, ease: tw.ease === "back.out" ? "back.out(1.4)" : tw.ease, immediateRender: first }), tw.at);
}
tl.eventCallback("onUpdate", () => { if (window.__stage) window.__stage(tl.time()); });
window.__timelines["main"] = tl;`;

  const html = `<!doctype html>
<html lang="${opts.plan.language === "hi" ? "hi" : "en"}" data-resolution="${layout.resolution}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${layout.w}, height=${layout.h}" />
  <title>${escapeHtml(opts.plan.title)}</title>
  <script src="assets/gsap.min.js"></script>
  ${performed.length && !stageVideo ? `<script type="importmap">{"imports":{"three":"./assets/three.module.js"}}</script>
  <script>window.__hf = window.__hf || {}; window.__hf.buildReady = window.__hf.buildReady || {}; window.__hf.buildReady.stage = new Promise(function (done) { window.__stageReady = done; });</script>` : ""}
  <style>${fontFace()}${css(layout)}${ILLUSTRATED_MODES.has(opts.plan.mode) ? illustratedCss(layout) : ""}${opts.plan.mode === "lyrics" ? lyricsCss(layout) : ""}${opts.plan.mode === "explainer" || opts.plan.mode === "code_lab" || opts.plan.mode === "audio" ? spokenCss() : ""}${opts.plan.mode === "code_lab" ? codeLabCss() : ""}</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${layout.w}" data-height="${layout.h}">
    <div class="wash"></div>
    ${stageVideo ? `<video id="stage" class="clip" src="${stageVideo}" data-start="0" data-duration="${duration}" data-track-index="0" muted playsinline></video>` : performed.length ? `<canvas id="stage" width="${layout.w}" height="${layout.h}"></canvas>` : ""}
    ${scenes.join("\n")}
    ${captions.join("\n")}
    ${audios.join("\n")}
  </div>
  ${performed.length && !stageVideo ? `<script type="module" src="assets/stage.mjs"></script>` : ""}
  <script>${script}</script>
</body>
</html>`;

  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  }, null, 2));
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({
    name: "scenespindle-render",
    private: true,
    type: "module",
    scripts: {
      check: "npx --yes hyperframes@0.8.176 check",
      render: "npx --yes hyperframes@0.8.176 render",
    },
  }, null, 2));
  writeFileSync(resolve(dir, "timeline.json"), JSON.stringify(opts.timeline, null, 2));
}
