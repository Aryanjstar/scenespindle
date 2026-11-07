import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
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

function filterPath(file: string): string {
  return file.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

/** Burn outlined captions into a copy of the reel. The band is the creator's choice. */
export async function burnCaptionReel(opts: { video: string; cues: CaptionCue[]; band: CaptionBand; srtPath: string; out: string; size?: "regular" | "big" }): Promise<void> {
  writeFileSync(opts.srtPath, toSrt(opts.cues.map((cue) => ({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs, words: [] }))));
  const align = opts.band === "upper" ? 8 : opts.band === "middle" ? 5 : 2;
  const margin = opts.band === "middle" ? 0 : 72;
  const style = `Alignment=${align},Fontname=Liberation Sans,Fontsize=${opts.size === "big" ? 28 : 22},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00120D18,BorderStyle=1,Outline=2,Shadow=0,MarginV=${margin}`;
  await run("ffmpeg", [
    "-hide_banner", "-nostdin", "-y",
    "-i", opts.video,
    "-vf", `subtitles=${filterPath(opts.srtPath)}:force_style='${style}'`,
    "-c:a", "copy",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    opts.out,
  ], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
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
