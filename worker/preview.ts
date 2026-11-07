import mongoose from "mongoose";
import { validatePlan } from "../src/contracts/plan";
import { Project, Storyboard, Video } from "../src/server/db";
import { estimatedTimeline, previewHtml } from "../src/server/studio";
import { loadTrace } from "../src/server/trace-load";
import { claimOne, settleBadge, Stop } from "./lease";

/** Claims preview jobs: a silent HTML preview with estimated timing, versioned like films. */
export function processPreview(): Promise<boolean> {
  return claimOne({
    match: { type: "render", "input.output": { $nin: ["mp4", "montage"] } },
    leaseMs: 30_000,
    exhausted: { code: "WORKER_EXHAUSTED", message: "Preview could not be completed. Please try again.", retryable: true },
    failure: () => ({ code: "PREVIEW_FAILED", message: "Could not prepare the preview.", retryable: true }),
    onFailed: settleBadge,
    run: async (lease) => {
      const { job } = lease;
      await lease.stage([{ name: "preview", state: "running" }]);
      const storyboard = await Storyboard.findOne({ _id: job.input.storyboardId, ownerId: job.ownerId, projectId: job.projectId });
      const checked = validatePlan(storyboard?.plan);
      if (!storyboard || !checked.plan) throw new Error("The approved storyboard is not valid.");
      const timeline = estimatedTimeline(checked.plan);
      const trace = checked.plan.mode === "code_lab" ? await loadTrace(job.ownerId, storyboard.traceId) : null;
      const html = previewHtml(checked.plan, timeline, trace ?? undefined);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Older previews were numbered without the counter; never reuse a version number.
          const latest = await Video.findOne({ projectId: job.projectId }).sort({ version: -1 }).select("version").session(session);
          await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId }, { $max: { videoVersion: latest?.version ?? 0 } }, { session });
          const counter = await Project.findOneAndUpdate({ _id: job.projectId, ownerId: job.ownerId, deletedAt: { $exists: false } }, { $inc: { videoVersion: 1 }, $set: { badge: "review" } }, { session, new: true });
          if (!counter) throw new Stop();
          const [video] = await Video.create([{ ownerId: job.ownerId, projectId: job.projectId, storyboardId: storyboard._id, version: counter.videoVersion, format: job.input.format, state: "preview", kind: "preview", jobId: job._id, durationMs: timeline.durationMs, warnings: ["This is a silent preview with estimated timing, not a video export."], previewHtml: html, commercialSafe: false }], { session });
          await lease.succeed({ videoId: video._id, storyboardId: storyboard._id }, session);
        });
      } finally { await session.endSession(); }
    },
  });
}
