import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { escapeHtml } from "../compiler/escape";
import { hyperframesBin } from "./render";
import { promisify } from "node:util";
import { toSrt } from "./subtitles";
import { parseLrc } from "./lyrics";

const run = promisify(execFile);

export type CaptionCue = { startMs: number; endMs: number; text: string };
export type CaptionBand = "lower" | "middle" | "upper";

function stampToMs(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms.padEnd(3, "0").slice(0, 3));
}

/** Timed cues from an SRT, an LRC file, or plain lines spaced across the reel. */
export function parseCaptionText(input: string, durationMs: number): { cues: CaptionCue[]; timing: "file" | "even" } {
  const text = input.replaceAll("\r", "").trim();
  if (text.includes("-->")) {
    const cues: CaptionCue[] = [];
    for (const block of text.split(/\n\s*\n/)) {
      const match = block.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*\n([\s\S]+)/);
      if (!match) continue;
      const line = match[9].replaceAll(/[—–]/g, ", ").replace(/\s+/g, " ").trim();
      if (!line) continue;
      const startMs = stampToMs(match[1], match[2], match[3], match[4]);
      const endMs = stampToMs(match[5], match[6], match[7], match[8]);
      if (endMs > startMs) cues.push({ startMs, endMs, text: line.slice(0, 120) });
    }
    if (cues.length) return { cues: cues.slice(0, 200), timing: "file" };
  }
  if (/\[\d{1,3}:\d{2}/.test(text)) {
    const lines = parseLrc(text).filter((line) => line.text.length > 0);
    const cues = lines.slice(0, 200).map((line, index) => ({
      startMs: line.startMs,
      endMs: lines[index + 1]?.startMs ?? Math.min(durationMs, line.startMs + 4000),
      text: line.text.slice(0, 120),
    })).filter((cue) => cue.endMs > cue.startMs);
    if (cues.length) return { cues, timing: "file" };
  }
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 40);
  if (!lines.length) throw new Error("Add a line of captions, an SRT, or an LRC file.");
  const slice = Math.max(400, durationMs / lines.length);
  return {
    timing: "even",
    cues: lines.map((line, index) => ({
      startMs: Math.round(index * slice),
      endMs: Math.min(durationMs, Math.round((index + 1) * slice) - 40),
      text: line.slice(0, 120),
    })),
  };
}

export async function probeReel(file: string): Promise<{ durationMs: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Could not read that reel.");
  return { durationMs: Math.round(seconds * 1000) };
}

/**
 * Burn captions onto a copy of the reel with the studio renderer (HyperFrames), so captions use the
 * film fonts on every machine, with no dependency on an FFmpeg build that has libass. The picture is
 * re-encoded with the captions; the reel's own sound is copied back unchanged.
 */
export async function burnCaptionReel(opts: { video: string; cues: CaptionCue[]; band: CaptionBand; srtPath: string; out: string; size?: "regular" | "big"; words?: { text: string; startMs: number; endMs: number }[] }): Promise<void> {
  writeFileSync(opts.srtPath, toSrt(opts.cues.map((cue) => ({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs, words: [] }))));
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", opts.video], { encoding: "utf8" });
  const info = JSON.parse(String(probe.stdout)) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  const w = Math.max(2, Math.round((info.streams?.[0]?.width ?? 1080) / 2) * 2);
  const h = Math.max(2, Math.round((info.streams?.[0]?.height ?? 1920) / 2) * 2);
  const seconds = Number(info.format?.duration ?? 0) || Math.max(1, ...opts.cues.map((c) => c.endMs / 1000));
  const dir = resolve(dirname(opts.out), "captions-project");
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  copyFileSync(opts.video, resolve(dir, "assets/reel.mp4"));
  copyFileSync(resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  copyFileSync(resolve(process.cwd(), "node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2"), resolve(dir, "assets/fonts/bricolage.woff2"));
  copyFileSync(resolve(process.cwd(), "node_modules/@fontsource/anek-devanagari/files/anek-devanagari-devanagari-700-normal.woff2"), resolve(dir, "assets/fonts/anek.woff2"));
  const k = Math.min(w, h) / 1080;
  const size = Math.round((opts.size === "big" ? 78 : 56) * k);
  const top = opts.band === "upper" ? "14%" : opts.band === "middle" ? "44%" : "74%";
  const tweens: { target: string; at: number; duration: number }[] = [];
  const clips = opts.cues.map((cue, i) => {
    const words = cue.text.split(/\s+/).filter(Boolean);
    const inner = words.map((word, n) => `<span id="c${i}w${n}" class="w">${escapeHtml(word)}</span>`).join(" ");
    // Punchy captions light up word by word on measured times when they exist.
    const heard = (opts.words ?? []).filter((x) => x.startMs >= cue.startMs - 20 && x.endMs <= cue.endMs + 20);
    words.forEach((_, n) => {
      const at = heard[n] ? heard[n].startMs / 1000 : cue.startMs / 1000 + ((cue.endMs - cue.startMs) / 1000) * (n / Math.max(1, words.length));
      if (opts.size === "big") tweens.push({ target: `c${i}w${n}`, at, duration: 0.08 });
    });
    return `<div id="c${i}" class="clip cap" data-start="${(cue.startMs / 1000).toFixed(3)}" data-duration="${Math.max(0.1, (cue.endMs - cue.startMs) / 1000).toFixed(3)}" data-track-index="2">${inner}</div>`;
  });
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${w}, height=${h}"><script src="assets/gsap.min.js"></script><style>
@font-face { font-family: Cap; src: url("assets/fonts/anek.woff2") format("woff2"); font-weight: 700; unicode-range: U+0900-097F; }
@font-face { font-family: Cap; src: url("assets/fonts/bricolage.woff2") format("woff2"); font-weight: 700; }
html,body{margin:0;background:#000}#root{position:relative;width:${w}px;height:${h}px;overflow:hidden}
#bg{position:absolute;inset:0;width:${w}px;height:${h}px;object-fit:cover}
.cap{position:absolute;left:6%;right:6%;top:${top};text-align:center;font-family:Cap,sans-serif;font-weight:700;font-size:${size}px;line-height:1.15;color:#fff8ee;text-shadow:-3px 0 0 #120d18,3px 0 0 #120d18,0 -3px 0 #120d18,0 3px 0 #120d18,0 6px 18px rgba(0,0,0,.45)}
.w{display:inline-block}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${seconds.toFixed(3)}" data-width="${w}" data-height="${h}">
<video id="bg" class="clip" src="assets/reel.mp4" data-start="0" data-duration="${seconds.toFixed(3)}" data-track-index="0" muted playsinline></video>
${clips.join("\n")}
</div><script>const tl=gsap.timeline({paused:true});for(const t of ${JSON.stringify(tweens)}){tl.fromTo("#"+t.target,{color:"#fff8ee",scale:1},{color:"#ffd31a",scale:1.08,duration:t.duration,immediateRender:false},t.at);}
window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></body></html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  const raw = resolve(dir, "raw.mp4");
  await run(process.execPath, [hyperframesBin(), "render", "--quality", "draft", "--output", raw], { cwd: dir, timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "", SARVAM_API_KEY: "", MONGODB_URI: "" } });
  const audio = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", opts.video], { encoding: "utf8" });
  if (String(audio.stdout).trim()) {
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", raw, "-i", opts.video, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "apad", "-t", seconds.toFixed(3), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", opts.out], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  } else {
    // A silent reel stays silent, with a silent track so every player and platform accepts it.
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", raw, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-t", seconds.toFixed(3), "-movflags", "+faststart", opts.out], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  }
}

/** Mono 16 kHz WAV of the reel's sound, for transcription. */
export async function extractSpeech(video: string, wav: string): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
}

/** Cues from heard words. Punchy keeps 2 to 3 words on screen; phrase keeps up to 6, breaking on punctuation. */
export function cuesFromWords(words: { text: string; startMs: number; endMs: number }[], style: "punchy" | "phrase"): CaptionCue[] {
  const max = style === "punchy" ? 3 : 6;
  const cues: CaptionCue[] = [];
  let pending: typeof words = [];
  const flush = () => {
    if (!pending.length) return;
    cues.push({ startMs: pending[0].startMs, endMs: Math.max(pending[pending.length - 1].endMs, pending[0].startMs + 300), text: pending.map((w) => w.text).join(" ").replaceAll(/[—–]/g, ", ").slice(0, 120) });
    pending = [];
  };
  for (const word of words) {
    if (pending.length && word.startMs - pending[pending.length - 1].endMs > 600) flush();
    pending.push(word);
    if (pending.length >= max || /[.!?,।][”’"']?$/.test(word.text)) flush();
  }
  flush();
  // Keep cues in order and never overlapping.
  for (let i = 1; i < cues.length; i++) if (cues[i].startMs < cues[i - 1].endMs) cues[i - 1].endMs = cues[i].startMs;
  return cues.filter((cue) => cue.endMs > cue.startMs);
}

export async function probeSize(file: string): Promise<{ width: number; height: number; durationMs: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const parsed = JSON.parse(String(stdout)) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  return { width: parsed.streams?.[0]?.width ?? 0, height: parsed.streams?.[0]?.height ?? 0, durationMs: Math.round(Number(parsed.format?.duration ?? 0) * 1000) };
}

/** A few evenly spaced frames as JPEGs, for choosing where captions can go. */
export async function sampleFrames(video: string, durationMs: number, dir: string, count = 6): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) / count) * (durationMs / 1000);
    const file = `${dir}/frame-${i}.jpg`;
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=-2:480", "-q:v", "5", file], { timeout: 60_000 });
    out.push(file);
  }
  return out;
}

/** Thumbnail and an 8-frame contact sheet for review. */
export async function reelPreviews(video: string, durationMs: number, thumb: string, sheet: string): Promise<void> {
  const seconds = durationMs / 1000;
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-ss", Math.min(1, seconds / 3).toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale='min(960,iw/2)':-2", "-q:v", "3", thumb], { timeout: 60_000 });
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", video, "-vf", `fps=1/${Math.max(1, seconds / 8).toFixed(3)},scale=270:-2,tile=4x2:padding=6:color=0x141415`, "-frames:v", "1", "-q:v", "4", sheet], { timeout: 120_000 });
}

/* ------------------------------------------------------------------ karaoke lyric video */

export type KaraokeWord = { text: string; startMs: number; endMs: number };
export type KaraokeLine = { text: string; startMs: number; endMs: number; words: KaraokeWord[]; doubtful: boolean };

/** Lowercase romanized lyric lines; Devanagari is refused so the screen stays in English letters. */
export function lyricLines(input: string): { lines: string[]; timed: { startMs: number; text: string }[] | null } {
  const raw = input.replaceAll("\r", "").trim();
  if (/[ऀ-ॿ]/.test(raw)) throw new Error("Write the lyrics in English letters (romanized), not Devanagari.");
  if (/\[\d{1,3}:\d{2}/.test(raw)) {
    const timed = parseLrc(raw).filter((l) => l.text).map((l) => ({ startMs: l.startMs, text: l.text.toLowerCase().replaceAll(/[—–]/g, ", ").trim() }));
    return { lines: timed.map((l) => l.text), timed };
  }
  const lines = raw.split(/\n+/).map((l) => l.toLowerCase().replaceAll(/[—–]/g, ", ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 120);
  if (!lines.length) throw new Error("Paste the lyrics, one sung line per row.");
  return { lines, timed: null };
}

/**
 * Give each lyric line and word its time. With LRC times, lines keep them and words take the heard
 * words inside the line (or spread evenly). Without, lines follow the heard-word sequence in order.
 * The text on screen is always the creator's lyrics; only times come from the audio.
 */
export function alignLyrics(lines: string[], timed: { startMs: number }[] | null, heard: KaraokeWord[], durationMs: number): KaraokeLine[] {
  const words = lines.map((l) => l.split(" ").filter(Boolean));
  const spread = (text: string[], start: number, end: number): KaraokeWord[] => text.map((t, i) => ({ text: t, startMs: Math.round(start + ((end - start) * i) / text.length), endMs: Math.round(start + ((end - start) * (i + 1)) / text.length) }));
  const out: KaraokeLine[] = [];
  if (timed) {
    lines.forEach((text, i) => {
      const start = timed[i].startMs;
      const end = Math.min(durationMs, timed[i + 1]?.startMs ?? Math.min(durationMs, start + 5000));
      const inside = heard.filter((w) => w.startMs >= start - 150 && w.startMs < end);
      const w = words[i];
      const wordTimes = inside.length === w.length ? w.map((t, n) => ({ text: t, startMs: inside[n].startMs, endMs: inside[n].endMs })) : inside.length ? w.map((t, n) => { const h = inside[Math.min(inside.length - 1, Math.floor((n * inside.length) / w.length))]; return { text: t, startMs: h.startMs, endMs: h.endMs }; }) : spread(w, start, end);
      out.push({ text, startMs: start, endMs: end, words: wordTimes, doubtful: Math.abs(inside.length - w.length) > Math.max(2, w.length * 0.5) });
    });
    return out;
  }
  if (!heard.length) throw new Error("No singing was heard in the reel. Add LRC times to your lyrics instead.");
  const total = words.reduce((n, w) => n + w.length, 0);
  let used = 0;
  lines.forEach((text, i) => {
    const w = words[i];
    const from = Math.floor((used * heard.length) / total);
    const to = Math.max(from + 1, Math.floor(((used + w.length) * heard.length) / total));
    used += w.length;
    const span = heard.slice(from, Math.min(heard.length, to));
    const start = span[0]?.startMs ?? 0;
    const end = span[span.length - 1]?.endMs ?? start + 2000;
    const wordTimes = span.length === w.length ? w.map((t, n) => ({ text: t, startMs: span[n].startMs, endMs: span[n].endMs })) : w.map((t, n) => { const h = span[Math.min(span.length - 1, Math.floor((n * span.length) / w.length))]; return { text: t, startMs: h.startMs, endMs: h.endMs }; });
    out.push({ text, startMs: start, endMs: end, words: wordTimes, doubtful: Math.abs(span.length - w.length) > Math.max(2, w.length * 0.5) });
  });
  return out;
}

/**
 * Karaoke lyric video over the creator's own footage, styled to their brief: one small line at a
 * time above the head, Instrument Serif italic in a peach, pink and lilac gradient with a soft glow,
 * unsung words dim until sung, a slow push-in, a warm night grade with vignette and grain, and the
 * original singing raised to about -17.6 LUFS without clipping. Lyrics are escaped text.
 */
export async function burnKaraoke(opts: { video: string; lines: KaraokeLine[]; out: string; placement: "above-head" | "top" | "bottom" }): Promise<void> {
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", opts.video], { encoding: "utf8" });
  const info = JSON.parse(String(probe.stdout)) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  const w = Math.max(2, Math.round((info.streams?.[0]?.width ?? 1080) / 2) * 2);
  const h = Math.max(2, Math.round((info.streams?.[0]?.height ?? 1920) / 2) * 2);
  const seconds = Number(info.format?.duration ?? 0) || 10;
  const dir = resolve(dirname(opts.out), "karaoke-project");
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  // Night look on the footage: lifted blacks, a touch warmer, vignette and light film grain.
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", opts.video, "-vf", "eq=brightness=0.035:contrast=0.94:saturation=1.06:gamma=1.06,colorbalance=rs=0.04:gs=0.01:bs=-0.03:rm=0.03:bm=-0.02,vignette=angle=0.5,noise=alls=9:allf=t,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", resolve(dir, "assets/reel.mp4")], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  copyFileSync(resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  copyFileSync(resolve(process.cwd(), "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2"), resolve(dir, "assets/fonts/instrument-italic.woff2"));
  const k = w / 1080;
  const ky = h / 1920;
  const top = opts.placement === "bottom" ? Math.round(1500 * ky) : opts.placement === "top" ? Math.round(180 * ky) : Math.round(330 * ky);
  const tweens: string[] = [];
  const lines = opts.lines.map((line, i) => {
    const next = opts.lines[i + 1];
    const start = line.startMs / 1000;
    const end = Math.min(seconds, next ? Math.max(start + 0.5, next.startMs / 1000) : Math.max(line.endMs / 1000 + 0.6, start + 0.6));
    const id = `l${i}`;
    tweens.push(`tl.fromTo("#${id}",{opacity:0,y:${Math.round(16 * k)},filter:"blur(8px)"},{opacity:1,y:0,filter:"blur(0px)",duration:0.4,ease:"power3.out",immediateRender:false},${(start).toFixed(3)});`);
    line.words.forEach((word, n) => tweens.push(`tl.fromTo("#${id}w${n}",{opacity:0.28,y:0},{opacity:1,y:${-Math.round(3 * k)},duration:0.12,ease:"power2.out",immediateRender:false},${Math.max(start, word.startMs / 1000).toFixed(3)});`));
    tweens.push(`tl.to("#${id}",{opacity:0,y:${-Math.round(12 * k)},filter:"blur(6px)",duration:0.24,ease:"power2.in"},${Math.max(start + 0.3, end - 0.24).toFixed(3)});`);
    const inner = line.words.map((word, n) => `<span id="${id}w${n}" class="w">${escapeHtml(word.text)}</span>`).join(" ");
    return `<div id="${id}" class="clip line" data-start="${start.toFixed(3)}" data-duration="${(end - start).toFixed(3)}" data-track-index="3">${inner}</div>`;
  });
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${w}, height=${h}"><script src="assets/gsap.min.js"></script><style>
@font-face { font-family: "Instrument Serif"; src: url("assets/fonts/instrument-italic.woff2") format("woff2"); font-style: italic; font-weight: 400; font-display: block; }
html,body{margin:0;background:#000}#root{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#000}
#push{position:absolute;inset:0;transform-origin:50% 45%}
#bg{position:absolute;inset:0;width:${w}px;height:${h}px;object-fit:cover}
#scrim{position:absolute;left:0;right:0;top:0;height:${Math.round(640 * ky)}px;background:linear-gradient(to bottom,rgba(12,6,14,.62),rgba(12,6,14,0))}
.line{position:absolute;left:${Math.round(60 * k)}px;right:${Math.round(60 * k)}px;top:${top}px;height:${Math.round(120 * ky)}px;display:flex;align-items:center;justify-content:center;white-space:nowrap;font-family:"Instrument Serif",serif;font-style:italic;font-size:${Math.round(58 * k)}px;line-height:1;letter-spacing:-0.015em;filter:drop-shadow(0 0 ${Math.round(10 * k)}px rgba(255,140,170,.5)) drop-shadow(0 ${Math.round(2 * k)}px ${Math.round(6 * k)}px rgba(0,0,0,.6))}
.w{display:inline-block;margin:0 0.12em;background:linear-gradient(100deg,#ffe3b3,#ffb3c7,#e9b8ff);-webkit-background-clip:text;background-clip:text;color:transparent;opacity:.28}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${seconds.toFixed(3)}" data-width="${w}" data-height="${h}">
<div id="push"><video id="bg" class="clip" src="assets/reel.mp4" data-start="0" data-duration="${seconds.toFixed(3)}" data-track-index="0" muted playsinline></video></div>
<div id="scrim"></div>
${lines.join("\n")}
</div><script>const tl=gsap.timeline({paused:true});tl.fromTo("#push",{scale:1},{scale:1.07,duration:${seconds.toFixed(3)},ease:"none"},0);${tweens.join("")}
window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></body></html>`;
  writeFileSync(resolve(dir, "index.html"), html);
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" }, media: { autoProxy: true } }));
  const raw = resolve(dir, "raw.mp4");
  await run(process.execPath, [hyperframesBin(), "render", "--quality", "standard", "--output", raw], { cwd: dir, timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "", SARVAM_API_KEY: "", MONGODB_URI: "" } });
  // The singer's own voice: raised to about -17.6 LUFS, true peak held near -4 dB. Two passes:
  // measure first, then apply one linear gain, so the voice is not pumped by a compressor.
  const target = "I=-17.6:TP=-4:LRA=11";
  const measured = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", opts.video, "-vn", "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(String(measured.stderr));
  const stats = m ? (JSON.parse(m[0]) as Record<string, string>) : null;
  const filter = stats && Number.isFinite(Number(stats.input_i))
    ? `loudnorm=${target}:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`
    : `loudnorm=${target}`;
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", raw, "-i", opts.video, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", `${filter},aresample=48000,apad`, "-t", seconds.toFixed(3), "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", opts.out], { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
}
