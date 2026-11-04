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
export async function burnCaptionReel(opts: { video: string; cues: CaptionCue[]; band: CaptionBand; srtPath: string; out: string }): Promise<void> {
  writeFileSync(opts.srtPath, toSrt(opts.cues.map((cue) => ({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs, words: [] }))));
  const align = opts.band === "upper" ? 8 : opts.band === "middle" ? 5 : 2;
  const margin = opts.band === "middle" ? 0 : 72;
  const style = `Alignment=${align},Fontname=Liberation Sans,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00120D18,BorderStyle=1,Outline=2,Shadow=0,MarginV=${margin}`;
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
