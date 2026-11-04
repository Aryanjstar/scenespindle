import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { validatePlan } from "../src/contracts/plan";
import { loadEnv } from "../src/config/env";
import { voiceEntry, voiceUnavailable } from "../src/config/providers";
import { renderMontage } from "../src/pipeline/montage";
import { RENDERER, renderFilm, type QaReport } from "../src/pipeline/render";
import { Asset, Job, Project, Storyboard, Video } from "../src/server/db";
import { ProviderError } from "../src/server/providers/errors";
import { fetchToFile, putFile, removePrefix } from "../src/server/storage";
import { loadTrace } from "../src/server/trace-load";
import { resolveStills } from "../src/server/stills";
import { songLines } from "../src/pipeline/lyrics";
import { QuotaError, reserve } from "../src/server/usage";

const leaseMs = 60_000;
const FILM_STAGES = ["voice", "timeline", "frames", "mix", "qa"];
const MONTAGE_STAGES = ["beats", "cuts", "mix", "qa"];
const OUTPUTS = ["mp4", "montage"];

class Stop extends Error {}

type Made = {
  mp4: string; thumb: string; sheet: string; srt?: string; vtt?: string;
  durationMs: number; qa: QaReport; warnings: string[];
  voiceId?: string; timing?: "aligned" | "estimated"; renderer: string; commercial: boolean; storyboardId?: unknown;
};

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

/** Claims one film or montage job, renders it, and publishes only a QA-passed result as current. */
export async function processRender(): Promise<boolean> {
  const now = new Date();
  const token = randomUUID();
  const job = await Job.findOneAndUpdate({
    type: "render", "input.output": { $in: OUTPUTS }, attempts: { $lt: 3 },
    $or: [{ state: "queued", runAfter: { $lte: now } }, { state: "running", leaseExpiresAt: { $lte: now } }],
  }, {
    $set: { state: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    $inc: { attempts: 1 },
  }, { sort: { runAfter: 1, _id: 1 }, new: true });
  if (!job) {
    await Job.updateMany({ type: "render", "input.output": { $in: OUTPUTS }, state: "running", attempts: { $gte: 3 }, leaseExpiresAt: { $lte: now } }, {
      $set: { state: "failed", finishedAt: now, error: { code: "WORKER_EXHAUSTED", message: "The film could not be rendered after three tries. Your previous video is unchanged.", retryable: true } },
      $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
    });
    return false;
  }
  const stagesFor = job.input.output === "montage" ? MONTAGE_STAGES : FILM_STAGES;
  const held = () => ({ _id: job._id, state: "running", leaseToken: token, leaseExpiresAt: { $gt: new Date() } });
  const abort = new AbortController();
  const timer = setInterval(() => {
    void Job.updateOne(held(), { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } })
      .then((result) => { if (!result.modifiedCount) abort.abort(); })
      .catch(() => {});
  }, 10_000);
  timer.unref();
  // One folder per attempt, so a renderer orphaned by a crashed worker cannot write into a retry.
  const workDir = resolve(process.env.RENDER_WORK_DIR || resolve(process.cwd(), ".data", "work"), `${String(job._id)}-${job.attempts}`);
  let stored = "";
  const onStage = async (stage: string) => {
    if (abort.signal.aborted) throw new Stop();
    const index = stagesFor.indexOf(stage);
    const stages = stagesFor.map((name, i) => ({ name, state: i < index ? "done" : i === index ? "running" : "queued" }));
    const updated = await Job.updateOne(held(), { $set: { stages, progress: Math.round((index / stagesFor.length) * 100) } });
    if (!updated.modifiedCount) throw new Stop();
  };
  try {
    const project = await Project.findOne({ _id: job.projectId, ownerId: job.ownerId, deletedAt: { $exists: false } });
    if (!project) throw new Stop();
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
      const result = await renderMontage({ clips, music, format: job.input.format, seconds: job.input.seconds, workDir, onStage: (stage) => onStage(stage) });
      made = { ...result, renderer: "ffmpeg-montage@1", commercial: false, warnings: [...result.warnings, `Cut on ${result.cuts} beats${result.bpm ? ` at ${result.bpm} BPM` : ""}. Check that you have the rights to every clip and the music before sharing.`] };
    } else {
      const storyboard = await Storyboard.findOne({ _id: job.input.storyboardId, ownerId: job.ownerId, projectId: job.projectId });
      const checked = validatePlan(storyboard?.plan);
      if (!storyboard || !checked.plan) throw new Error("The approved storyboard is not valid.");
      const env = loadEnv();
      const songMode = checked.plan.mode === "lyrics";
      const voice = songMode ? { ...voiceEntry("test:tone")!, id: "song", label: "Song", commercial: false } : voiceEntry(String(job.input.voiceId ?? ""));
      if (!voice) throw new ProviderError("invalid", "Unknown voice");
      if (!songMode && voiceUnavailable(voice, env, checked.plan.language)) throw new ProviderError("auth", "Voice not configured");
      const images = await resolveStills(job.ownerId, checked.plan, resolve(workDir, "in"));
      let song: { file: string; lines: ReturnType<typeof songLines> } | undefined;
      if (songMode) {
        const asset = await Asset.findOne({ _id: checked.plan.songAssetId, ownerId: job.ownerId, kind: "audio" });
        if (!asset) throw new Error("A clip in this montage was removed. Choose the song again.");
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
        beforeCall: async (chars) => {
          if (abort.signal.aborted) throw new Stop();
          const settle = await reserve(voice.provider, chars);
          await settle();
        },
        onStage: (stage) => onStage(stage),
      });
      made = { ...result, voiceId: songMode ? undefined : voice.id, renderer: RENDERER, commercial: voice.commercial, storyboardId: storyboard._id };
      if (songMode) made.warnings.push("Check that you have the rights to the song before sharing.");
      if (Object.keys(images).length) made.warnings.push("Pictures were generated from your descriptions and character sheets. Review them before sharing.");
    }
    if (abort.signal.aborted) throw new Stop();

    const videoId = new mongoose.Types.ObjectId();
    const prefix = `videos/${String(job.ownerId)}/${String(videoId)}`;
    stored = prefix;
    const mp4 = await putFile(`${prefix}/film.mp4`, made.mp4);
    await putFile(`${prefix}/thumb.jpg`, made.thumb);
    await putFile(`${prefix}/sheet.jpg`, made.sheet);
    if (made.srt) await putFile(`${prefix}/captions.srt`, made.srt);
    if (made.vtt) await putFile(`${prefix}/captions.vtt`, made.vtt);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const claim = await Job.updateOne(held(), { $set: { state: "succeeded", finishedAt: new Date(), progress: 100, stages: stagesFor.map((name) => ({ name, state: "done" })) }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } }, { session });
        if (!claim.modifiedCount) throw new Stop();
        const latest = await Video.findOne({ projectId: job.projectId }).sort({ version: -1 }).select("version").session(session);
        await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId }, { $max: { videoVersion: latest?.version ?? 0 } }, { session });
        const counter = await Project.findOneAndUpdate(
          { _id: job.projectId, ownerId: job.ownerId, deletedAt: { $exists: false } },
          { $inc: { videoVersion: 1 } },
          { session, new: true },
        );
        if (!counter) throw new Stop();
        const ready = made.qa.passed;
        await Video.create([{
          _id: videoId,
          ownerId: job.ownerId, projectId: job.projectId, storyboardId: made.storyboardId,
          version: counter.videoVersion, format: job.input.format, kind: "mp4",
          state: ready ? "ready" : "failed", jobId: job._id, durationMs: made.durationMs,
          warnings: ready ? made.warnings : [...made.warnings, "This render did not pass QA, so it is not your current video."],
          voiceId: made.voiceId, timing: made.timing, renderer: made.renderer,
          artifacts: {
            mp4: mp4.key, thumb: `${prefix}/thumb.jpg`, sheet: `${prefix}/sheet.jpg`,
            ...(made.srt ? { srt: `${prefix}/captions.srt` } : {}), ...(made.vtt ? { vtt: `${prefix}/captions.vtt` } : {}),
            bytes: mp4.bytes, sha256: mp4.sha256,
          },
          mp4Path: mp4.key,
          qa: made.qa,
          commercialSafe: made.commercial,
        }], { session });
        // The last good video stays current until a new one passes QA.
        await Project.updateOne(
          { _id: job.projectId, ownerId: job.ownerId },
          ready ? { $set: { currentVideoId: videoId, badge: "ready" } } : { $set: { badge: "review" } },
          { session },
        );
        await Job.updateOne({ _id: job._id }, { $set: { result: { videoId, storyboardId: made.storyboardId, qaPassed: ready } } }, { session });
      });
      stored = "";
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (stored) await removePrefix(stored).catch(() => console.error("cleanup-failed"));
    if (!(error instanceof Stop)) {
      const reason = failure(error);
      // Operational detail only: renderer/ffmpeg messages, never keys or scripts.
      console.error("render-failed", String(job._id), reason.code, error instanceof Error ? error.message.replaceAll(/\s+/g, " ").slice(0, 400) : "");
      await Job.updateOne(held(), {
        $set: { state: "failed", finishedAt: new Date(), error: reason },
        $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
      });
      await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId, badge: "rendering" }, { $set: { badge: "review" } });
    }
  } finally {
    clearInterval(timer);
    if (!process.env.KEEP_RENDER_WORK) rmSync(workDir, { recursive: true, force: true });
  }
  return true;
}
