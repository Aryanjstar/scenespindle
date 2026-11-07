import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { LAYOUTS } from "../compiler/compile";
import type { Format } from "../contracts/plan";
import { hyperframesBin, probeVideo, type QaReport } from "./render";
import { compileOverlay } from "../compiler/montage-overlay";
import { GRADE_FILTER, montageStyle, type MontageSettings, type MontageStyle } from "../catalog/montage-styles";

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

/**
 * Cut points on the beat grid. two-beats is the calm default; beat and half-beat give the
 * 0.3 to 0.8 s micro-cuts of aesthetic vlogs. Shots never get shorter than minShot.
 */
export function cutPoints(beats: number[], seconds: number, fallback = 1.6, pacing: "two-beats" | "beat" | "half-beat" = "two-beats", minShot = 0.8): number[] {
  const cuts = [0];
  let grid: number[];
  if (beats.length >= 4) {
    if (pacing === "two-beats") grid = beats.filter((_, i) => i % 2 === 0);
    else if (pacing === "beat") grid = beats;
    else grid = beats.flatMap((b, i) => (beats[i + 1] !== undefined ? [b, Number(((b + beats[i + 1]) / 2).toFixed(3))] : [b]));
  } else {
    const step = pacing === "two-beats" ? fallback : pacing === "beat" ? fallback / 2 : fallback / 4;
    grid = Array.from({ length: Math.ceil(seconds / step) + 1 }, (_, i) => Number((i * step).toFixed(3)));
  }
  for (const t of grid) if (t - cuts[cuts.length - 1] >= minShot && t < seconds - Math.max(0.3, minShot / 2)) cuts.push(t);
  cuts.push(seconds);
  return cuts;
}

/**
 * Auto shot picking: the most lively window of a clip. Scene scores (frame-to-frame change)
 * are sampled at 4 fps; the window with the highest average motion wins, ignoring hard cuts.
 */
export async function liveliestStart(file: string, total: number, length: number): Promise<number> {
  if (total <= length + 0.25) return 0;
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-t", String(Math.min(total, 120)), "-vf", "fps=4,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", "-an", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const scores = [...stderr.matchAll(/lavfi\.scene_score=([0-9.]+)/g)].map((m) => Math.min(0.25, Number(m[1])));
    if (scores.length < 4) return 0;
    const win = Math.max(1, Math.round(length * 4));
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i + win <= scores.length; i++) {
      const mean = scores.slice(i, i + win).reduce((a, b) => a + b, 0) / win;
      if (mean > bestScore) { bestScore = mean; best = i; }
    }
    return Math.min(best / 4, Math.max(0, total - length));
  } catch {
    return 0;
  }
}

export async function renderMontage(opts: {
  clips: MontageClip[];
  music?: string | null;
  format: Format;
  seconds: number;
  workDir: string;
  style?: MontageStyle;
  settings?: Partial<MontageSettings>;
  signal?: AbortSignal;
  onStage?: (stage: "beats" | "cuts" | "mix" | "qa") => Promise<void>;
}): Promise<{ mp4: string; thumb: string; sheet: string; durationMs: number; qa: QaReport; warnings: string[]; bpm: number; cuts: number; edl: { durationMs: number; cuts: number[]; clips: number[] } }> {
  const style = opts.style ?? montageStyle("beat-cut@1");
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
  const cuts = cutPoints(beats, seconds, 1.6, style.pacing, style.minShot);
  const grade = GRADE_FILTER[style.grade] ?? "";
  const fit = `scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,crop=${layout.w}:${layout.h},setsar=1,fps=30${grade},format=yuv420p`;
  let videoShots = 0;
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
      await ffmpeg(["-loop", "1", "-t", String(length), "-i", clip.file, "-vf", `scale=${layout.w * 2}:${layout.h * 2}:force_original_aspect_ratio=increase,crop=${layout.w * 2}:${layout.h * 2},zoompan=z='${zoom}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${layout.w}x${layout.h}:fps=30,setsar=1${grade},format=yuv420p`, "-frames:v", String(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", part]);
    } else {
      videoShots += 1;
      // Speed ramp: every Nth video shot plays faster, like walking or transit shots in vlogs.
      const rate = style.rampEvery > 0 && videoShots % style.rampEvery === 0 ? 1.6 : 1;
      const need = length * rate;
      const total = await durationOf(clip.file);
      let start: number;
      if (!offsets.has(clip.file) && total > need) {
        // First use of a clip: its most lively moment. Later uses continue after it.
        start = await liveliestStart(clip.file, total, need);
      } else {
        const used = offsets.get(clip.file) ?? 0;
        start = total > need ? Math.min(used, Math.max(0, total - need)) : 0;
      }
      offsets.set(clip.file, total > need ? (start + need + 0.5) % Math.max(0.1, total - need) : 0);
      const speed = rate === 1 ? "" : `setpts=PTS/${rate},`;
      await ffmpeg(["-ss", start.toFixed(3), "-stream_loop", "-1", "-i", clip.file, "-t", need.toFixed(3), "-vf", `${speed}${fit}`, "-t", String(length), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", part]);
    }
    if (opts.signal?.aborted) throw new Error("STOP");
    list.push(`file '${part}'`);
  }
  const listFile = resolve(parts, "list.txt");
  writeFileSync(listFile, list.join("\n"));

  await opts.onStage?.("mix");
  const picture = resolve(out, "picture.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", picture]);
  const mp4 = resolve(out, "film.mp4");
  if (style.overlay !== "none" || style.sfx) {
    // Text and sound on top of the cut picture, rendered by HyperFrames, then the loudness mix.
    const project = resolve(opts.workDir, "overlay");
    const library = resolve(process.cwd(), "library", "sfx");
    compileOverlay({
      format: opts.format, seconds, style,
      settings: { kicker: opts.settings?.kicker ?? "", title: opts.settings?.title ?? "", subtitle: opts.settings?.subtitle ?? "", chapters: opts.settings?.chapters ?? [], outro: opts.settings?.outro ?? "", outroSub: opts.settings?.outroSub ?? "" },
      cuts, music: opts.music ?? null,
    }, project, { picture, music: opts.music ?? null, sfx: { swish: resolve(library, "swish.wav"), click: resolve(library, "click.wav"), pop: resolve(library, "pop.wav"), chime: resolve(library, "chime.wav") } });
    const raw = resolve(out, "raw.mp4");
    await run(process.execPath, [hyperframesBin(), "render", "--quality", "draft", "--output", raw], {
      cwd: project, timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, signal: opts.signal,
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "", SARVAM_API_KEY: "", MONGODB_URI: "" },
    });
    await ffmpeg(["-i", raw, "-t", seconds.toFixed(3), "-c:v", "copy",
      "-af", `afade=t=out:st=${Math.max(0, seconds - 1.2).toFixed(3)}:d=1.2,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.8:level=false:attack=1:release=50,afade=t=in:d=0.03`, "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", mp4]);
    if (!opts.music) warnings.push("No music was chosen, so the montage has only the edit sounds.");
  } else if (opts.music) {
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
  if (!opts.music && !(style.overlay !== "none" || style.sfx)) {
    // Silence is intended here; loudness checks do not apply.
    qa.checks = qa.checks.filter((check) => check.name !== "loudness" && check.name !== "true peak");
    qa.passed = qa.checks.every((check) => check.ok);
  }
  return { mp4, thumb, sheet, durationMs: qa.durationMs, qa, warnings, bpm, cuts: cuts.length - 1, edl: { durationMs: Math.round(seconds * 1000), cuts, clips: cuts.slice(0, -1).map((_, i) => i % opts.clips.length) } };
}
