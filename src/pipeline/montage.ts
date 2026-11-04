import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { LAYOUTS } from "../compiler/compile";
import type { Format } from "../contracts/plan";
import { probeVideo, type QaReport } from "./render";

const run = promisify(execFile);

/**
 * Beat-driven montage: the creator's own clips and photos, cut on beats measured
 * from their music. Originals are read, never modified. FFmpeg only.
 */
export type MontageClip = { file: string; kind: "image" | "video" };

async function ffmpeg(args: string[], timeoutMs = 300_000) {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
}

async function durationOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const seconds = Number(stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

/** Decode audio to mono PCM and find beat times from an onset envelope. */
export async function detectBeats(music: string, maxSeconds: number): Promise<{ beats: number[]; bpm: number }> {
  const rate = 11025;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", music, "-t", String(maxSeconds), "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }) as unknown as { stdout: Buffer };
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  return beatsFromSamples(samples, rate);
}

export function beatsFromSamples(samples: Int16Array, rate: number): { beats: number[]; bpm: number } {
  const hop = 128;
  const energy: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += (samples[j] / 32768) ** 2;
    energy.push(Math.sqrt(sum / hop));
  }
  const flux = energy.map((value, i) => Math.max(0, value - (energy[i - 1] ?? 0)));
  const frameSec = hop / rate;
  // Tempo from autocorrelation of the onset envelope, 70 to 180 BPM.
  let bestLag = 0;
  let bestScore = -1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = Math.round(60 / bpm / frameSec);
    let score = 0;
    for (let i = lag; i < flux.length; i++) score += flux[i] * flux[i - lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const period = bestLag * frameSec;
  if (!period || bestScore <= 0) return { beats: [], bpm: 0 };
  // Phase: the offset whose grid collects the most onset energy.
  let bestPhase = 0;
  let phaseScore = -1;
  for (let offset = 0; offset < bestLag; offset++) {
    let score = 0;
    for (let i = offset; i < flux.length; i += bestLag) score += flux[i];
    if (score > phaseScore) { phaseScore = score; bestPhase = offset; }
  }
  const beats: number[] = [];
  for (let t = bestPhase * frameSec; t < samples.length / rate; t += period) beats.push(Number(t.toFixed(3)));
  return { beats, bpm: Math.round(60 / period) };
}

/** Cut points: every two beats, at least 0.8 s apart, covering the film length. */
export function cutPoints(beats: number[], seconds: number, fallback = 1.6): number[] {
  const cuts = [0];
  const grid = beats.length >= 4 ? beats.filter((_, i) => i % 2 === 0) : Array.from({ length: Math.ceil(seconds / fallback) + 1 }, (_, i) => i * fallback);
  for (const t of grid) if (t - cuts[cuts.length - 1] >= 0.8 && t < seconds - 0.4) cuts.push(t);
  cuts.push(seconds);
  return cuts;
}

export async function renderMontage(opts: {
  clips: MontageClip[];
  music?: string | null;
  format: Format;
  seconds: number;
  workDir: string;
  onStage?: (stage: "beats" | "cuts" | "mix" | "qa") => Promise<void>;
}): Promise<{ mp4: string; thumb: string; sheet: string; durationMs: number; qa: QaReport; warnings: string[]; bpm: number; cuts: number }> {
  if (!opts.clips.length) throw new Error("Choose at least one photo or clip.");
  const layout = LAYOUTS[opts.format];
  const out = resolve(opts.workDir, "out");
  const parts = resolve(opts.workDir, "parts");
  mkdirSync(out, { recursive: true });
  mkdirSync(parts, { recursive: true });
  const warnings: string[] = [];

  await opts.onStage?.("beats");
  let seconds = Math.max(5, Math.min(180, opts.seconds));
  let beats: number[] = [];
  let bpm = 0;
  if (opts.music) {
    const musicLength = await durationOf(opts.music);
    if (musicLength > 0 && musicLength < seconds) seconds = musicLength;
    ({ beats, bpm } = await detectBeats(opts.music, seconds));
    if (!beats.length) warnings.push("No steady beat was found in the music, so cuts are evenly spaced.");
  } else {
    warnings.push("No music was chosen, so the montage is silent and cuts are evenly spaced.");
  }

  await opts.onStage?.("cuts");
  const cuts = cutPoints(beats, seconds);
  const fit = `scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,crop=${layout.w}:${layout.h},setsar=1,fps=30,format=yuv420p`;
  const offsets = new Map<string, number>();
  const list: string[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const clip = opts.clips[i % opts.clips.length];
    const length = Number((cuts[i + 1] - cuts[i]).toFixed(3));
    const part = resolve(parts, `p${String(i).padStart(3, "0")}.mp4`);
    if (clip.kind === "image") {
      // A slow push-in on stills, alternating direction.
      const frames = Math.max(1, Math.round(length * 30));
      const zoom = i % 2 === 0 ? `min(1+0.0012*on,1.12)` : `max(1.12-0.0012*on,1)`;
      await ffmpeg(["-loop", "1", "-t", String(length), "-i", clip.file, "-vf", `scale=${layout.w * 2}:${layout.h * 2}:force_original_aspect_ratio=increase,crop=${layout.w * 2}:${layout.h * 2},zoompan=z='${zoom}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${layout.w}x${layout.h}:fps=30,setsar=1,format=yuv420p`, "-frames:v", String(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", part]);
    } else {
      const total = await durationOf(clip.file);
      const used = offsets.get(clip.file) ?? 0;
      const start = total > length ? Math.min(used, Math.max(0, total - length)) : 0;
      offsets.set(clip.file, total > length ? (start + length + 0.5) % Math.max(0.1, total - length) : 0);
      await ffmpeg(["-ss", start.toFixed(3), "-stream_loop", "-1", "-i", clip.file, "-t", String(length), "-vf", fit, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", part]);
    }
    list.push(`file '${part}'`);
  }
  const listFile = resolve(parts, "list.txt");
  writeFileSync(listFile, list.join("\n"));

  await opts.onStage?.("mix");
  const picture = resolve(out, "picture.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", picture]);
  const mp4 = resolve(out, "film.mp4");
  if (opts.music) {
    await ffmpeg(["-i", picture, "-i", opts.music, "-map", "0:v", "-map", "1:a", "-t", seconds.toFixed(3), "-c:v", "copy",
      "-af", `afade=t=out:st=${Math.max(0, seconds - 1.2).toFixed(3)}:d=1.2,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.8:level=false:attack=1:release=50,afade=t=in:d=0.03`, "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", mp4]);
  } else {
    await ffmpeg(["-i", picture, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v", "-map", "1:a", "-t", seconds.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mp4]);
  }
  const thumb = resolve(out, "thumb.jpg");
  await ffmpeg(["-ss", Math.min(1, seconds / 3).toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale='min(960,iw/2)':-2", "-q:v", "3", thumb]);
  const sheet = resolve(out, "sheet.jpg");
  await ffmpeg(["-i", mp4, "-vf", `fps=1/${Math.max(1, seconds / 8).toFixed(3)},scale=270:-2,tile=4x2:padding=6:color=0x141415`, "-frames:v", "1", "-q:v", "4", sheet]);

  await opts.onStage?.("qa");
  const qa = await probeVideo(mp4, Math.round(seconds * 1000), { width: layout.w, height: layout.h });
  if (!opts.music) {
    // Silence is intended here; loudness checks do not apply.
    qa.checks = qa.checks.filter((check) => check.name !== "loudness" && check.name !== "true peak");
    qa.passed = qa.checks.every((check) => check.ok);
  }
  return { mp4, thumb, sheet, durationMs: qa.durationMs, qa, warnings, bpm, cuts: cuts.length - 1 };
}
