import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { validatePlan } from "../src/contracts/plan";
import { loadEnv } from "../src/config/env";
import { voiceCandidates, voiceEntry, voiceUnavailable } from "../src/config/providers";
import { renderMontage } from "../src/pipeline/montage";
import { RENDERER, renderFilm, type QaReport } from "../src/pipeline/render";
import { Asset, Job, Project, Storyboard, Video } from "../src/server/db";
import { ProviderError } from "../src/server/providers/errors";
import { fetchToFile } from "../src/server/storage";
import { loadTrace } from "../src/server/trace-load";
import { resolveStills } from "../src/server/stills";
import { songLines } from "../src/pipeline/lyrics";
import { QuotaError, reserve } from "../src/server/usage";
import { claimOne, settleBadge, Stop, type Lease } from "./lease";
import { storageVoiceCache } from "../src/server/voice-cache";
import { montageSettingsSchema, resolveMontage } from "../src/catalog/montage-styles";
import { applyInstructions } from "../src/server/montage-direction";
import { learnedStyle } from "../src/server/style-analysis";

const leaseMs = 60_000;
const FILM_STAGES = ["voice", "timeline", "frames", "mix", "qa"];
const MONTAGE_STAGES = ["beats", "cuts", "mix", "qa"];
const OUTPUTS = ["mp4", "montage"];


export type { Made } from "../src/server/publish";
import { publishMade, type Made } from "../src/server/publish";

function failure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof QuotaError) return { code: "QUOTA_EXHAUSTED", message: error.message, retryable: false };
  if (error instanceof ProviderError) {
    if (error.kind === "auth") return { code: "VOICE_UNAVAILABLE", message: "The narrator is not available. Check the voice key, then retry.", retryable: true };
    if (error.kind === "quota") return { code: "QUOTA_EXHAUSTED", message: "The voice provider allowance is used up.", retryable: false };
    if (error.kind === "rate_limited") return { code: "RATE_LIMITED", message: "The voice provider asked us to slow down. Retry in a minute.", retryable: true };
    if (error.kind === "invalid") return { code: "VOICE_REJECTED", message: "The voice provider rejected a line. Edit the line or choose another voice.", retryable: false };
    return { code: "VOICE_UNAVAILABLE", message: "The voice provider is unavailable. Retry later.", retryable: true };
  }
  if (error instanceof Error && /timings did not cover/.test(error.message)) return { code: "ALIGNMENT_FAILED", message: error.message, retryable: true };
  if (error instanceof Error && /^(Choose at least|The recorded trace|A clip)/.test(error.message)) return { code: "INPUT_MISSING", message: error.message, retryable: false };
  return { code: "RENDER_FAILED", message: "The film could not be rendered. Your previous video is unchanged.", retryable: true };
}

/** Claims one hosted film or montage job, renders it, and publishes only a QA-passed result as current. */
export function processRender(): Promise<boolean> {
  return claimOne({
    match: { type: "render", "input.output": { $in: OUTPUTS }, target: { $ne: "paired-agent" } },
    leaseMs,
    exhausted: { code: "WORKER_EXHAUSTED", message: "The film could not be rendered after three tries. Your previous video is unchanged.", retryable: true },
    failure,
    onFailed: settleBadge,
    run: (lease) => renderJob(lease),
  });
}

/** Renders one claimed job. Shared by the hosted worker and the paired PC agent. */
export async function renderJob(lease: Lease): Promise<void> {
  const { job } = lease;
  const stagesFor = job.input.output === "montage" ? MONTAGE_STAGES : FILM_STAGES;
  const held = lease.held;
  const abort = { signal: lease.signal };
  // One folder per attempt, so a renderer orphaned by a crashed worker cannot write into a retry.
  const workDir = resolve(process.env.RENDER_WORK_DIR || resolve(process.cwd(), ".data", "work"), `${String(job._id)}-${job.attempts}`);
  const onStage = async (stage: string) => {
    if (abort.signal.aborted) throw new Stop();
    const index = stagesFor.indexOf(stage);
    const stages = stagesFor.map((name, i) => ({ name, state: i < index ? "done" : i === index ? "running" : "queued" }));
    await lease.stage(stages, Math.round((index / stagesFor.length) * 100));
  };
  try {
    const project = await Project.findOne({ _id: job.projectId, ownerId: job.ownerId, deletedAt: { $exists: false } });
    if (!project) {
      await Job.updateOne(held(), { $set: { state: "cancelled", finishedAt: new Date() }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } });
      throw new Stop();
    }
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });

    let made: Made;
    if (job.input.output === "montage") {
      // Inputs were frozen at enqueue time; ownership is checked again here.
      const ids = [...(job.input.assetIds ?? []), ...(job.input.musicAssetId ? [job.input.musicAssetId] : [])];
      const assets = await Asset.find({ _id: { $in: ids }, ownerId: job.ownerId });
      const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
      const clips: { file: string; kind: "image" | "video" }[] = [];
      for (const [n, id] of (job.input.assetIds as string[]).entries()) {
        const asset = byId.get(String(id));
        if (!asset || (asset.kind !== "image" && asset.kind !== "video")) throw new Error("A clip in this montage was removed. Choose the clips again.");
        clips.push({ file: await fetchToFile(asset.path, resolve(workDir, "in", `clip-${n}.${asset.path.split(".").pop()}`)), kind: asset.kind as "image" | "video" });
      }
      const musicAsset = job.input.musicAssetId ? byId.get(String(job.input.musicAssetId)) : null;
      if (job.input.musicAssetId && (!musicAsset || musicAsset.kind !== "audio")) throw new Error("A clip in this montage was removed. Choose the music again.");
      const music = musicAsset ? await fetchToFile(musicAsset.path, resolve(workDir, "in", `music.${musicAsset.path.split(".").pop()}`)) : null;
      const frozen = montageSettingsSchema.safeParse(job.input.settings ?? {});
      let settings = frozen.success ? frozen.data : montageSettingsSchema.parse({});
      const directed = await applyInstructions(settings, job.ownerId).catch(() => ({ settings, note: "Your edit notes could not be applied right now; the style's defaults were used." }));
      settings = directed.settings;
      const learned = job.input.learned?.spec ? learnedStyle(job.input.learned.spec) : null;
      const style = resolveMontage({ ...settings, styleId: job.input.learned?.base && !job.input.settings?.styleId ? job.input.learned.base : settings.styleId }, learned);
      const result = await renderMontage({ clips, music, format: job.input.format, seconds: job.input.seconds, workDir, style, settings, signal: abort.signal, onStage: (stage) => onStage(stage) });
      if (directed.note) result.warnings.push(directed.note);
      made = { ...result, renderer: style.overlay === "none" && !style.sfx ? "ffmpeg-montage@1" : `ffmpeg-montage@2+${style.id}+${RENDERER}`, commercial: false, warnings: [...result.warnings, `Cut on ${result.cuts} beats${result.bpm ? ` at ${result.bpm} BPM` : ""}. Check that you have the rights to every clip and the music before sharing.`] };
    } else {
      const storyboard = await Storyboard.findOne({ _id: job.input.storyboardId, ownerId: job.ownerId, projectId: job.projectId });
      const checked = validatePlan(storyboard?.plan);
      if (!storyboard || !checked.plan) throw new Error("The approved storyboard is not valid.");
      const env = loadEnv();
      const songMode = checked.plan.mode === "lyrics";
      const voice = songMode ? { ...voiceEntry("test:tone")!, id: "song", label: "Song", commercial: false } : voiceEntry(String(job.input.voiceId ?? ""));
      if (!voice) throw new ProviderError("invalid", "Unknown voice");
      if (!songMode && voiceCandidates(voice.id, checked.plan.language, env).length === 0) throw new ProviderError("auth", voiceUnavailable(voice, env, checked.plan.language) ?? "No narrator is configured for this language.");
      const images = await resolveStills(job.ownerId, checked.plan, resolve(workDir, "in"));
      let song: { file: string; lines: ReturnType<typeof songLines> } | undefined;
      if (songMode) {
        const asset = await Asset.findOne({ _id: checked.plan.songAssetId, ownerId: job.ownerId, kind: "audio" });
        if (!asset) throw new Error("A clip in this film was removed. Choose the song again.");
        song = { file: await fetchToFile(asset.path, resolve(workDir, "in", `song.${asset.path.split(".").pop()}`)), lines: songLines(checked.plan) };
      }
      const trace = checked.plan.mode === "code_lab" ? await loadTrace(job.ownerId, storyboard.traceId) : null;
      if (checked.plan.mode === "code_lab" && !trace) throw new Error("The recorded trace for this Code Lab film is missing.");
      const result = await renderFilm({
        plan: checked.plan,
        voice,
        keys: env,
        workDir,
        cacheDir: resolve(process.env.VOICE_CACHE_DIR || resolve(process.cwd(), ".data", "cache", "voice")),
        quality: (process.env.RENDER_QUALITY as "draft" | "standard" | "high" | undefined) ?? "draft",
        signal: abort.signal,
        trace: trace ?? undefined,
        images,
        song,
        voiceCache: storageVoiceCache,
        beforeCall: async (chars, speaking) => {
          if (abort.signal.aborted) throw new Stop();
          // Speech is billed when requested, so the units count once the call is made.
          const settle = await reserve(speaking.provider, chars, job.ownerId);
          await settle();
        },
        onStage: (stage) => onStage(stage),
      });
      made = { ...result, voiceId: songMode ? undefined : result.voiceId, renderer: RENDERER, commercial: result.voiceCommercial, storyboardId: storyboard._id, edl: result.edl };
      if (songMode) made.warnings.push("Check that you have the rights to the song before sharing.");
      if (Object.keys(images).length) made.warnings.push("Pictures were generated from your descriptions and character sheets. Review them before sharing.");
    }
    if (abort.signal.aborted) throw new Stop();

    await publishMade(lease, made, stagesFor);
  } finally {
    if (!process.env.KEEP_RENDER_WORK) rmSync(workDir, { recursive: true, force: true });
  }
}

