import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { validatePlan } from "../src/contracts/plan";
import { Job, Project, Storyboard, Video } from "../src/server/db";
import { estimatedTimeline, previewHtml } from "../src/server/studio";
import { loadTrace } from "../src/server/trace-load";

const leaseMs = 30_000;

/** Claims only preview jobs; other job types remain with their existing execution path. */
export async function processPreview(): Promise<boolean> {
  const now = new Date();
  const token = randomUUID();
  const job = await Job.findOneAndUpdate({
    type: "render", "input.output": { $nin: ["mp4", "montage"] }, attempts: { $lt: 3 },
    $or: [{ state: "queued", runAfter: { $lte: now } }, { state: "running", leaseExpiresAt: { $lte: now } }],
  }, { $set: { state: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs), stages: [{ name: "preview", state: "running" }] }, $inc: { attempts: 1 } }, { sort: { runAfter: 1, _id: 1 }, new: true });
  if (!job) {
    await Job.updateMany({ type: "render", "input.output": { $nin: ["mp4", "montage"] }, state: "running", attempts: { $gte: 3 }, leaseExpiresAt: { $lte: now } }, {
      $set: { state: "failed", finishedAt: now, error: { code: "WORKER_EXHAUSTED", message: "Preview could not be completed. Please try again.", retryable: true } },
      $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
    });
    return false;
  }
  const filter = { _id: job._id, state: "running", leaseToken: token, leaseExpiresAt: { $gt: new Date() } };
  const timer = setInterval(() => {
    void Job.updateOne({ _id: job._id, state: "running", leaseToken: token, leaseExpiresAt: { $gt: new Date() } }, { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }).catch(() => {});
  }, 10_000);
  timer.unref();
  try {
    const storyboard = await Storyboard.findOne({ _id: job.input.storyboardId, ownerId: job.ownerId, projectId: job.projectId });
    const checked = validatePlan(storyboard?.plan);
    if (!checked.plan) throw new Error("The approved storyboard is not valid.");
    const timeline = estimatedTimeline(checked.plan);
    const trace = checked.plan.mode === "code_lab" ? await loadTrace(job.ownerId, storyboard!.traceId) : null;
    const html = previewHtml(checked.plan, timeline, trace ?? undefined);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const claim = await Job.updateOne({ ...filter, leaseExpiresAt: { $gt: new Date() } }, { $set: { state: "succeeded", finishedAt: new Date() }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } }, { session });
        if (!claim.modifiedCount) throw new Error("LEASE_LOST");
        const project = await Project.findOne({ _id: job.projectId, ownerId: job.ownerId }).session(session);
        if (!project) throw new Error("PROJECT_MISSING");
        const latest = await Video.findOne({ projectId: job.projectId }).sort({ version: -1 }).session(session);
        const [video] = await Video.create([{ ownerId: job.ownerId, projectId: job.projectId, storyboardId: storyboard!._id, version: (latest?.version ?? 0) + 1, format: job.input.format, state: "preview", jobId: job._id, durationMs: timeline.durationMs, warnings: ["This is a silent preview with estimated timing, not a video export."], previewHtml: html, commercialSafe: false }], { session });
        await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId }, { $set: { badge: "review" } }, { session });
        await Job.updateOne({ _id: job._id }, { $set: { result: { videoId: video._id, storyboardId: storyboard!._id }, stages: [{ name: "preview", state: "done" }] } }, { session });
      });
    } finally { await session.endSession(); }
  } catch (error) {
    if (!(error instanceof Error && error.message === "LEASE_LOST")) {
      await Job.updateOne({ ...filter, leaseExpiresAt: { $gt: new Date() } }, { $set: { state: "failed", finishedAt: new Date(), error: { code: "PREVIEW_FAILED", message: "Could not prepare the preview.", retryable: true } }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } });
    }
  } finally { clearInterval(timer); }
  return true;
}
