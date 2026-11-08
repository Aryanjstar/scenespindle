import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { Plan } from "../contracts/plan";
import { compileProject, LAYOUTS, type CompileTrace, type Timeline } from "../compiler/compile";
import { voiceCandidates, voiceSwitchNotice, type ProviderKeys, type VoiceEntry } from "../config/providers";
import { ProviderError } from "../server/providers/errors";
import { QuotaError } from "../server/usage";
import { estimateWords, measureMs, speak } from "../server/providers/voice";
import type { WordTiming } from "../server/providers/elevenlabs";
import { buildTimeline, timingsCover } from "./make";
import { filmCaptions, toSrt, toVtt } from "./subtitles";

const run = promisify(execFile);
export const HYPERFRAMES_VERSION = "0.8.176";
export const RENDERER = `hyperframes@${HYPERFRAMES_VERSION}+ffmpeg-loudnorm@1`;

export type Stage = "voice" | "timeline" | "frames" | "mix" | "qa";

export type QaReport = {
  passed: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
  integratedLufs: number | null;
  truePeakDb: number | null;
};

export type RenderResult = {
  mp4: string;
  thumb: string;
  sheet: string;
  srt: string;
  vtt: string;
  durationMs: number;
  timing: "aligned" | "estimated";
  qa: QaReport;
  warnings: string[];
  voiceModel: string;
  providerChars: number;
  /** Narrator that actually spoke. May differ from the project voice when that one was out of credits. */
  voiceId: string;
  voiceCommercial: boolean;
  /** Scene and line times of the final film, for edit decision exports (OTIO, package). */
  edl: Edl;
};

export type Edl = {
  durationMs: number;
  scenes: { id: string; startMs: number; durationMs: number }[];
  lines: { sceneId: string; lineId: string; text: string; startMs: number; durationMs: number }[];
};

type Clip = { sceneId: string; lineId: string; text: string; audioFile: string; durationMs: number; words: WordTiming[] };

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function probeMs(file: string): number {
  const raw = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Could not measure a narration clip.");
  return Math.round(seconds * 1000);
}

export type SongLine = { sceneId: string; lineId: string; text: string; startMs: number; endMs: number };

/** Timeline for a lyric video: absolute line times from the LRC file, words spread inside each line. */
export function songTimeline(plan: Plan, lines: SongLine[], songMs: number): Timeline {
  const timed = lines.map((line) => {
    const durationMs = Math.max(400, line.endMs - line.startMs);
    return { sceneId: line.sceneId, lineId: line.lineId, text: line.text, audioFile: "", startMs: line.startMs, durationMs, words: estimateWords(line.text, durationMs, 40, 160) };
  });
  const last = timed[timed.length - 1];
  const durationMs = Math.min(songMs, (last ? last.startMs + last.durationMs : 0) + 2500);
  const scenes = plan.scenes.map((scene, index) => {
    const own = timed.filter((line) => line.sceneId === scene.id);
    const start = index === 0 ? 0 : own[0]?.startMs ?? 0;
    const nextStart = plan.scenes[index + 1] ? timed.find((line) => line.sceneId === plan.scenes[index + 1].id)?.startMs ?? durationMs : durationMs;
    return { id: scene.id, startMs: start, durationMs: Math.max(200, nextStart - start) };
  });
  return { durationMs, scenes, lines: timed };
}

/**
 * Narrate every line. Clips are cached by voice + text, so a retry or a re-render
 * of unchanged lines never calls the provider again.
 */
export type VoiceMeta = { ext: "mp3" | "wav"; words: WordTiming[]; timing: "aligned" | "estimated"; model: string };
/** get() downloads `${key}.${ext}` into dir and returns its meta; put() uploads it from dir. */
export type VoiceCacheStore = {
  get: (key: string, dir: string) => Promise<VoiceMeta | null>;
  put: (key: string, dir: string, meta: VoiceMeta) => Promise<void>;
};

export async function narratePlan(opts: {
  plan: Plan;
  voice: VoiceEntry;
  keys: ProviderKeys;
  cacheDir: string;
  assetsDir: string;
  /** Called with the character count before each uncached provider call. Throw to stop. */
  beforeCall?: (chars: number, voice: VoiceEntry) => Promise<void>;
  /** Shared cache (object storage) so narration survives restarts and is shared across workers. */
  shared?: VoiceCacheStore;
}): Promise<{ clips: Clip[]; timing: "aligned" | "estimated"; model: string; providerChars: number }> {
  mkdirSync(opts.cacheDir, { recursive: true });
  mkdirSync(opts.assetsDir, { recursive: true });
  const clips: Clip[] = [];
  let timing: "aligned" | "estimated" = "aligned";
  let model = "";
  let providerChars = 0;
  for (const scene of opts.plan.scenes) {
    for (const line of scene.lines) {
      const spoken = line.spoken ?? line.text;
      const key = sha(`${opts.voice.id}|${opts.voice.ref}|v1|${opts.plan.language === "en" ? "" : opts.plan.language + "|"}${spoken}`);
      const metaFile = resolve(opts.cacheDir, `${key}.json`);
      let meta: { ext: "mp3" | "wav"; words: WordTiming[]; timing: "aligned" | "estimated"; model: string } | null = null;
      if (existsSync(metaFile)) {
        meta = JSON.parse(readFileSync(metaFile, "utf8"));
        if (!existsSync(resolve(opts.cacheDir, `${key}.${meta!.ext}`))) meta = null;
      }
      if (!meta && opts.shared) {
        // Pull a clip another worker (or an earlier container) already paid for.
        const hit = await opts.shared.get(key, opts.cacheDir).catch(() => null);
        if (hit) { meta = hit; writeFileSync(metaFile, JSON.stringify(meta)); }
      }
      if (!meta) {
        await opts.beforeCall?.(spoken.length, opts.voice);
        const take = await speak(opts.voice, spoken, opts.keys, opts.plan.language);
        providerChars += opts.voice.provider === "test" ? 0 : spoken.length;
        let words = take.words;
        let timing = take.timing;
        if (timing === "aligned" && !timingsCover(spoken, words)) {
          words = estimateWords(spoken, measureMs(take.audio, take.ext));
          timing = "estimated";
        }
        writeFileSync(resolve(opts.cacheDir, `${key}.${take.ext}`), take.audio);
        meta = { ext: take.ext, words, timing, model: take.model };
        writeFileSync(metaFile, JSON.stringify(meta));
        if (opts.shared && opts.voice.provider !== "test") await opts.shared.put(key, opts.cacheDir, meta).catch(() => console.error("voice-cache-upload-failed"));
      }
      const audioName = `vo-${scene.id}-${line.id}.${meta.ext}`;
      const target = resolve(opts.assetsDir, audioName);
      copyFileSync(resolve(opts.cacheDir, `${key}.${meta.ext}`), target);
      const measured = probeMs(target);
      const lastWord = meta.words[meta.words.length - 1]?.endMs ?? 0;
      if (meta.timing === "estimated") timing = "estimated";
      model = meta.model;
      clips.push({ sceneId: scene.id, lineId: line.id, text: line.text, audioFile: `assets/${audioName}`, durationMs: Math.max(measured, lastWord), words: meta.words });
    }
  }
  return { clips, timing, model, providerChars };
}

function outOfCredits(error: unknown): boolean {
  return error instanceof QuotaError || (error instanceof ProviderError && error.kind === "quota");
}

/**
 * Speak the whole film in one voice. If the chosen voice is out of credits, try the
 * next configured voice and say who spoke. A failure that is not a credit problem
 * is not retried on a different voice.
 */
export async function narrateWithFallback(opts: {
  plan: Plan;
  voice: VoiceEntry;
  keys: ProviderKeys;
  cacheDir: string;
  assetsDir: string;
  beforeCall?: (chars: number, voice: VoiceEntry) => Promise<void>;
  shared?: VoiceCacheStore;
}): Promise<{ clips: Clip[]; timing: "aligned" | "estimated"; model: string; providerChars: number; voice: VoiceEntry; notice?: string }> {
  const candidates = voiceCandidates(opts.voice.id, opts.plan.language, opts.keys);
  if (!candidates.length) throw new ProviderError("auth", "No narrator is configured for this language.");
  let last: unknown;
  for (const candidate of candidates) {
    try {
      const voiced = await narratePlan({ ...opts, voice: candidate });
      return { ...voiced, voice: candidate, notice: voiceSwitchNotice(opts.voice, candidate) };
    } catch (error) {
      last = error;
      if (!outOfCredits(error)) throw error;
    }
  }
  if (last instanceof Error) throw last;
  throw new QuotaError(opts.voice.provider);
}

export function hyperframesBin(): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("hyperframes/package.json");
  return resolve(dirname(pkg), "bin/hyperframes.mjs");
}

async function ffmpeg(args: string[], timeoutMs = 300_000) {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
}

export async function measureLoudness(file: string): Promise<{ lufs: number | null; peak: number | null }> {
  const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(summary);
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  return { lufs: lufs ? Number(lufs[1]) : null, peak: peak && peak[1] !== "-inf" ? Number(peak[1]) : null };
}

export async function probeVideo(file: string, expectedMs: number, size: { width: number; height: number }): Promise<QaReport> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 8 * 1024 * 1024 });
  const info = JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration?: string } };
  const video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(Number(info.format.duration ?? 0) * 1000);
  const [num, den] = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = den ? num / den : 0;
  const loud = audio ? await measureLoudness(file) : { lufs: null, peak: null };
  const checks = [
    { name: "video stream", ok: video?.codec_name === "h264", detail: String(video?.codec_name ?? "missing") },
    { name: "audio stream", ok: audio?.codec_name === "aac", detail: String(audio?.codec_name ?? "missing") },
    { name: "dimensions", ok: video?.width === size.width && video?.height === size.height, detail: `${video?.width}x${video?.height}` },
    { name: "frame rate", ok: Math.abs(fps - 30) < 0.5, detail: fps.toFixed(2) },
    { name: "duration", ok: Math.abs(durationMs - expectedMs) <= 700, detail: `${durationMs} ms vs ${expectedMs} ms timeline` },
    { name: "loudness", ok: loud.lufs !== null && loud.lufs >= -16.5 && loud.lufs <= -11.5, detail: loud.lufs === null ? "silent" : `${loud.lufs} LUFS` },
    { name: "true peak", ok: loud.peak !== null && loud.peak <= -0.9, detail: loud.peak === null ? "none" : `${loud.peak} dBTP` },
  ];
  return {
    passed: checks.every((check) => check.ok),
    checks,
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps,
    durationMs,
    videoCodec: String(video?.codec_name ?? ""),
    audioCodec: String(audio?.codec_name ?? ""),
    integratedLufs: loud.lufs,
    truePeakDb: loud.peak,
  };
}

/**
 * Approved plan → narrated, captioned, loudness-checked MP4 with thumbnail,
 * contact sheet and subtitle files. Pure file work in workDir; the caller stores
 * the outputs and decides whether the film becomes current.
 */
export async function renderFilm(opts: {
  plan: Plan;
  voice: VoiceEntry;
  keys: ProviderKeys;
  workDir: string;
  cacheDir: string;
  onStage?: (stage: Stage) => Promise<void>;
  beforeCall?: (chars: number, voice: VoiceEntry) => Promise<void>;
  quality?: "draft" | "standard" | "high";
  signal?: AbortSignal;
  trace?: CompileTrace;
  images?: Record<string, string>;
  song?: { file: string; lines: SongLine[] };
  voiceCache?: VoiceCacheStore;
  /** Cinematic profile: renders the 3D stage offline and returns the video file to lay under the film. */
  stageRenderer?: (args: { plan: Plan; timeline: Timeline; workDir: string; signal?: AbortSignal }) => Promise<string | null>;
}): Promise<RenderResult> {
  const project = resolve(opts.workDir, "project");
  const out = resolve(opts.workDir, "out");
  mkdirSync(out, { recursive: true });
  const warnings: string[] = [];

  await opts.onStage?.("voice");
  let voiced: { timing: "aligned" | "estimated"; model: string; providerChars: number; clips: Parameters<typeof buildTimeline>[1]; voice: VoiceEntry; notice?: string };
  let timeline: Timeline;
  let audioTrack: string | undefined;
  let spokenVoice = opts.voice;
  if (opts.song) {
    // Lyric videos: the creator's song is the soundtrack and their LRC file sets line times.
    mkdirSync(resolve(project, "assets"), { recursive: true });
    const ext = opts.song.file.split(".").pop()?.toLowerCase() === "wav" ? "wav" : "mp3";
    audioTrack = `assets/song.${ext}`;
    copyFileSync(opts.song.file, resolve(project, audioTrack));
    timeline = songTimeline({ ...opts.plan, voiceId: opts.voice.id }, opts.song.lines, probeMs(opts.song.file));
    voiced = { timing: "estimated", model: "lrc", providerChars: 0, clips: [], voice: opts.voice };
    warnings.push("Line times come from your lyric file; word times inside a line are spread evenly.");
    await opts.onStage?.("timeline");
  } else {
    voiced = await narrateWithFallback({ plan: opts.plan, voice: opts.voice, keys: opts.keys, cacheDir: opts.cacheDir, assetsDir: resolve(project, "assets"), beforeCall: opts.beforeCall, shared: opts.voiceCache });
    spokenVoice = voiced.voice;
    if (voiced.notice) warnings.push(voiced.notice);
    if (voiced.timing === "estimated") warnings.push("Caption times are estimated from measured line lengths; this voice returns no word timestamps.");
    if (spokenVoice.provider === "test") warnings.push("Narration is a test tone, not speech.");
    if (!spokenVoice.commercial) warnings.push("This voice is licensed for non-commercial use only.");
    await opts.onStage?.("timeline");
    timeline = buildTimeline({ ...opts.plan, voiceId: spokenVoice.id }, voiced.clips);
  }
  const plan = { ...opts.plan, voiceId: spokenVoice.id };
  const stageVideo = opts.stageRenderer ? await opts.stageRenderer({ plan, timeline, workDir: resolve(opts.workDir, "stage"), signal: opts.signal }) : null;
  compileProject({ plan, timeline, outDir: project, trace: opts.trace, images: opts.images, audioTrack, stageVideo: stageVideo ?? undefined });

  await opts.onStage?.("frames");
  const raw = resolve(out, "raw.mp4");
  await run(process.execPath, [hyperframesBin(), "render", "--quality", opts.quality ?? "draft", "--output", raw], {
    cwd: project,
    timeout: 20 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    signal: opts.signal,
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", GEMINI_API_KEY: "", ELEVENLABS_API_KEY: "", SARVAM_API_KEY: "", AZURE_SPEECH_KEY: "", MONGODB_URI: "" },
  });
  if (!existsSync(raw)) throw new Error("The renderer did not produce a film.");

  await opts.onStage?.("mix");
  const mp4 = resolve(out, "film.mp4");
  await ffmpeg(["-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.8:level=false:attack=1:release=50,afade=t=in:d=0.03", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", mp4]);
  const thumb = resolve(out, "thumb.jpg");
  const at = Math.min(1.5, Math.max(0.2, timeline.durationMs / 2000));
  await ffmpeg(["-ss", at.toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale='min(960,iw/2)':-2", "-q:v", "3", thumb]);
  const sheet = resolve(out, "sheet.jpg");
  const every = Math.max(1, timeline.durationMs / 1000 / 8);
  await ffmpeg(["-i", mp4, "-vf", `fps=1/${every.toFixed(3)},scale=270:-2,tile=4x2:padding=6:color=0x141415`, "-frames:v", "1", "-q:v", "4", sheet]);
  const captions = filmCaptions(timeline);
  const srt = resolve(out, "captions.srt");
  const vtt = resolve(out, "captions.vtt");
  writeFileSync(srt, toSrt(captions));
  writeFileSync(vtt, toVtt(captions));

  await opts.onStage?.("qa");
  const layout = LAYOUTS[plan.format];
  const qa = await probeVideo(mp4, timeline.durationMs, { width: layout.w, height: layout.h });
  const edl: Edl = {
    durationMs: timeline.durationMs,
    scenes: timeline.scenes.map((scene) => ({ id: scene.id, startMs: scene.startMs, durationMs: scene.durationMs })),
    lines: timeline.lines.map((line) => ({ sceneId: line.sceneId, lineId: line.lineId, text: line.text, startMs: line.startMs, durationMs: line.durationMs })),
  };
  return { mp4, thumb, sheet, srt, vtt, durationMs: qa.durationMs, timing: voiced.timing, qa, warnings, voiceModel: voiced.model, providerChars: voiced.providerChars, voiceId: spokenVoice.id, voiceCommercial: spokenVoice.commercial, edl };
}
