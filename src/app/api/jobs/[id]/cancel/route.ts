import mongoose from "mongoose";
import { Character, Job, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";

/**
 * Cancel any of the creator's active jobs. The worker notices on its next lease check and stops;
 * a cancelled render never replaces the current video.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  const job = await Job.findOneAndUpdate(
    { _id: id, ownerId: auth.user!._id, state: { $in: ["queued", "running", "waiting_quota"] } },
    { $set: { state: "cancelled", finishedAt: new Date() }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } },
    { new: true },
  );
  if (job) {
    await Project.updateOne({ _id: job.projectId, ownerId: auth.user!._id, badge: { $in: ["planning", "rendering"] } }, { $set: { badge: "review" } });
    if (job.type === "image" && job.input?.kind === "character") await Character.updateOne({ _id: job.input.characterId, ownerId: auth.user!._id, state: "drawing" }, { $set: { state: "draft" } });
    return json({ id: String(job._id), state: job.state });
  }
  const existing = await Job.findOne({ _id: id, ownerId: auth.user!._id });
  if (!existing) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  if (existing.state === "cancelled") return json({ id: String(existing._id), state: "cancelled" });
  return apiError(409, "CONFLICT", "JOB_NOT_CANCELLABLE", "That job already finished.");
}
