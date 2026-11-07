import mongoose from "mongoose";
import { z } from "zod";
import { idempotent } from "../../../../../server/idempotency";
import { Asset, Job, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";
import { montageSettingsSchema } from "../../../../../catalog/montage-styles";
import { Style } from "../../../../../server/db";
import { limit } from "../../../../../server/rate-limit";

const bodySchema = z.object({
  assetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(24),
  musicAssetId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
  seconds: z.number().int().min(5).max(180).default(15),
  settings: montageSettingsSchema.optional(),
}).strict();

/** Queue a beat-cut montage from the creator's own library clips. Inputs are frozen into the job. */
async function handle(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "montage") return apiError(422, "VALIDATION", "WRONG_MODE", "Montages are made in a Montage project.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.path.includes("settings") ? `Check the montage text: ${parsed.error.issues[0]?.message}` : "Choose 1 to 24 clips and an optional music track.");
  const body = parsed.data;
  if (!(await limit(request, "render", 10, 60 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of renders this hour. Try again later.");
  const settings = body.settings ?? montageSettingsSchema.parse({});
  const learned = settings.savedStyleId ? await Style.findOne({ _id: settings.savedStyleId, ownerId: auth.user!._id, state: "ready" }).select("spec base") : null;
  if (settings.savedStyleId && !learned) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That saved style is not in your library.");
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
        target: project.executionTarget === "paired-agent" ? "paired-agent" : "hosted",
        input: { output: "montage", assetIds: body.assetIds, musicAssetId: body.musicAssetId ?? null, seconds: body.seconds, format: project.format, settings, learned: learned ? { base: learned.base, spec: learned.spec } : null },
        stages: ["beats", "cuts", "mix", "qa"].map((name) => ({ name, state: "queued" })), attempts: 0, runAfter: new Date(),
      }], { session });
      // The last montage settings stay on the project so the panel reopens with them.
      await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { badge: "rendering", montage: { ...settings, assetIds: body.assetIds, musicAssetId: body.musicAssetId ?? null, seconds: body.seconds } } }, { session });
      jobId = job._id;
    });
    return json({ jobId: String(jobId) }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start the montage.");
  } finally {
    await session.endSession();
  }
}

/** Accepts an Idempotency-Key header; a repeat returns the first response. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const text = await request.text();
  const replay = () => handle(new Request(request.url, { method: "POST", headers: request.headers, body: text }), ctx);
  return idempotent(request, auth.user!._id, `montage:${(await ctx.params).id}`, text, replay);
}
