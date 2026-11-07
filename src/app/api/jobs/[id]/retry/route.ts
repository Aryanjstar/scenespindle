import mongoose from "mongoose";
import { Job, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";

class Conflict extends Error {}

function stagesFor(job: { type: string; input?: { output?: string; kind?: string } }): string[] {
  if (job.type === "render") return job.input?.output === "mp4" ? ["voice", "timeline", "frames", "mix", "qa"] : job.input?.output === "montage" ? ["beats", "cuts", "mix", "qa"] : ["preview"];
  if (job.type === "image") return [job.input?.kind === "character" ? "sheet" : "stills"];
  if (job.type === "caption") return ["listen", "place", "burn", "qa"];
  return [job.type];
}
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  const session = await mongoose.startSession();
  try {
    let found = false;
    await session.withTransaction(async () => {
      const job = await Job.findOne({ _id: id, ownerId: auth.user!._id }).session(session);
      if (!job) return;
      found = true;
      if (!["failed", "cancelled"].includes(job.state)) throw new Conflict();
      // Jobs scoped to a character or style have no project; projects show a busy badge again.
      if (job.type === "render" || job.type === "plan" || job.type === "image" || job.type === "caption") {
        await Project.updateOne({ _id: job.projectId, ownerId: auth.user!._id }, { $set: { badge: job.type === "render" || job.type === "caption" ? "rendering" : "planning" } }, { session });
      }
      if (await Job.exists({ projectId: job.projectId, activeSlot: true, state: { $in: ["queued", "running", "waiting_quota"] } }).session(session)) throw new Conflict();
      const updated = await Job.updateOne({ _id: job._id, ownerId: auth.user!._id, state: job.state }, {
        $set: { state: "queued", activeSlot: true, attempts: 0, runAfter: new Date(), stages: stagesFor(job).map((name: string) => ({ name, state: "queued" })) },
        $unset: { error: 1, finishedAt: 1, leaseToken: 1, leaseExpiresAt: 1, result: 1 },
      }, { session });
      if (!updated.modifiedCount) throw new Conflict();
    });
    if (!found) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
    return json({ id, state: "queued" }, 202);
  } catch (error) {
    if (error instanceof Conflict) return apiError(409, "CONFLICT", "JOB_NOT_RETRYABLE", "This job cannot be retried while another job is active.");
    throw error;
  } finally { await session.endSession(); }
}
