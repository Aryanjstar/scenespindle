import mongoose from "mongoose";
import { z } from "zod";
import { Asset, Job, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";

const bodySchema = z.object({
  assetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(24),
  musicAssetId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
  seconds: z.number().int().min(5).max(180).default(15),
}).strict();

/** Queue a beat-cut montage from the creator's own library clips. Inputs are frozen into the job. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "montage") return apiError(422, "VALIDATION", "WRONG_MODE", "Montages are made in a Montage project.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose 1 to 24 clips and an optional music track.");
  const body = parsed.data;
  const clips = await Asset.find({ _id: { $in: body.assetIds }, ownerId: auth.user!._id, kind: { $in: ["image", "video"] } }).select("_id");
  if (clips.length !== new Set(body.assetIds).size) return apiError(404, "NOT_FOUND", "NOT_FOUND", "One of those clips is not in your library.");
  if (body.musicAssetId && !(await Asset.exists({ _id: body.musicAssetId, ownerId: auth.user!._id, kind: "audio" }))) {
    return apiError(404, "NOT_FOUND", "NOT_FOUND", "That music is not in your library.");
  }
  const session = await mongoose.startSession();
  try {
    let jobId: unknown;
    await session.withTransaction(async () => {
      const active = await Job.findOne({ projectId: project._id, activeSlot: true, state: { $in: ["queued", "running", "waiting_quota"] } }).session(session);
      if (active) {
        const error = new Error("PROJECT_BUSY") as Error & { jobId?: string };
        error.jobId = String(active._id);
        throw error;
      }
      const [job] = await Job.create([{
        ownerId: auth.user!._id, projectId: project._id, type: "render", state: "queued", activeSlot: true,
        input: { output: "montage", assetIds: body.assetIds, musicAssetId: body.musicAssetId ?? null, seconds: body.seconds, format: project.format },
        stages: ["beats", "cuts", "mix", "qa"].map((name) => ({ name, state: "queued" })), attempts: 0, runAfter: new Date(),
      }], { session });
      await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { badge: "rendering" } }, { session });
      jobId = job._id;
    });
    return json({ jobId: String(jobId) }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start the montage.");
  } finally {
    await session.endSession();
  }
}
