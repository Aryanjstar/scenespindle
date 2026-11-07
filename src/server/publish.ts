import mongoose from "mongoose";
import { Job, Project, Video } from "./db";
import { putFile, removePrefix } from "./storage";
import type { QaReport } from "../pipeline/render";

/** A finished film's local files and facts, ready to store and publish. */
export type Made = {
  mp4: string; thumb: string; sheet: string; srt?: string; vtt?: string;
  durationMs: number; qa: QaReport; warnings: string[];
  voiceId?: string; timing?: "aligned" | "estimated"; renderer: string; commercial: boolean; storyboardId?: unknown;
  edl?: unknown;
};

/**
 * Store a finished film's files and publish it as the next video version, all while holding the
 * lease. Only a QA-passed film becomes current; the previous good video stays current otherwise.
 */
export async function publishMade(lease: { job: { _id: unknown; ownerId: unknown; projectId: unknown; input: Record<string, any> }; held: () => Record<string, unknown> }, made: Made, stagesFor: string[], extra: Record<string, unknown> = {}): Promise<mongoose.Types.ObjectId> {
  const { job, held } = lease;
  const videoId = new mongoose.Types.ObjectId();
  const prefix = `videos/${String(job.ownerId)}/${String(videoId)}`;
  try {
    const mp4 = await putFile(`${prefix}/film.mp4`, made.mp4);
    await putFile(`${prefix}/thumb.jpg`, made.thumb);
    await putFile(`${prefix}/sheet.jpg`, made.sheet);
    if (made.srt) await putFile(`${prefix}/captions.srt`, made.srt);
    if (made.vtt) await putFile(`${prefix}/captions.vtt`, made.vtt);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const claim = await Job.updateOne(held(), { $set: { state: "succeeded", finishedAt: new Date(), progress: 100, stages: stagesFor.map((name) => ({ name, state: "done" })) }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } }, { session });
        if (!claim.modifiedCount) throw new Error("STOP");
        const latest = await Video.findOne({ projectId: job.projectId }).sort({ version: -1 }).select("version").session(session);
        await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId }, { $max: { videoVersion: latest?.version ?? 0 } }, { session });
        const counter = await Project.findOneAndUpdate({ _id: job.projectId, ownerId: job.ownerId, deletedAt: { $exists: false } }, { $inc: { videoVersion: 1 } }, { session, new: true });
        if (!counter) throw new Error("STOP");
        const ready = made.qa.passed;
        await Video.create([{
          _id: videoId, ownerId: job.ownerId, projectId: job.projectId, storyboardId: made.storyboardId,
          version: counter.videoVersion, format: job.input.format, kind: "mp4",
          state: ready ? "ready" : "failed", jobId: job._id, durationMs: made.durationMs,
          warnings: ready ? made.warnings : [...made.warnings, "This render did not pass QA, so it is not your current video."],
          voiceId: made.voiceId, timing: made.timing, renderer: made.renderer,
          artifacts: {
            mp4: mp4.key, thumb: `${prefix}/thumb.jpg`, sheet: `${prefix}/sheet.jpg`,
            ...(made.srt ? { srt: `${prefix}/captions.srt` } : {}), ...(made.vtt ? { vtt: `${prefix}/captions.vtt` } : {}),
            bytes: mp4.bytes, sha256: mp4.sha256,
          },
          mp4Path: mp4.key, qa: made.qa, commercialSafe: made.commercial, edl: made.edl, ...extra,
        }], { session });
        await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId }, ready ? { $set: { currentVideoId: videoId, badge: "ready" } } : { $set: { badge: "review" } }, { session });
        await Job.updateOne({ _id: job._id }, { $set: { result: { videoId, storyboardId: made.storyboardId, qaPassed: ready } } }, { session });
      });
    } finally {
      await session.endSession();
    }
    return videoId;
  } catch (error) {
    await removePrefix(prefix).catch(() => console.error("cleanup-failed"));
    throw error;
  }
}
