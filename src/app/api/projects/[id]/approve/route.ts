import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "../../../../../server/http";
import { Draft, Job, Project, Storyboard } from "../../../../../server/db";
import { authed, busy, json } from "../../../../../server/guard";
import { hashPlan, ownProject } from "../../../../../server/studio";
import { validatePlan } from "../../../../../contracts/plan";
import { loadEnv } from "../../../../../config/env";
import { voiceEntry, voiceUnavailable } from "../../../../../config/providers";
import { missingStills } from "../../../../../server/stills";
import { SeriesVersion } from "../../../../../server/db";

export const maxDuration = 60;
const bodySchema = z.object({ draftRevision: z.number().int().positive(), planHash: z.string().regex(/^[a-f0-9]{64}$/), output: z.enum(["preview", "mp4"]).default("preview") }).strict();
class ApprovalError extends Error { constructor(public reason: string, public revision?: number) { super(reason); } }

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "A valid draft revision and plan hash are required.");
  const body = parsed.data;
  const song = project.mode === "lyrics";
  const voice = song ? { id: "song" } as ReturnType<typeof voiceEntry> : voiceEntry(project.voiceId);
  if (body.output === "mp4" && !song) {
    const blocked = !voice ? "Choose a narrator in project settings." : voiceUnavailable(voice, loadEnv());
    if (blocked) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", blocked);
  }
  const session = await mongoose.startSession();
  let jobId: mongoose.Types.ObjectId | undefined;
  let storyboardId: mongoose.Types.ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      // A write to the draft fences concurrent saves until this snapshot commits.
      const draft = await Draft.findOneAndUpdate(
        { projectId: project._id, ownerId: auth.user!._id, revision: body.draftRevision },
        { $set: { approvalFence: randomUUID() } }, { session, new: true },
      );
      if (!draft) {
        const current = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id }).session(session).select("revision");
        throw new ApprovalError("REVISION_CONFLICT", current?.revision);
      }
      const checked = validatePlan(draft.plan);
      if (!checked.plan) throw new ApprovalError("PLAN_INVALID");
      if (body.output === "mp4" && !song && voice && voiceUnavailable(voice, loadEnv(), checked.plan.language)) throw new ApprovalError("VOICE_LANGUAGE");
      if (missingStills(checked.plan).length) throw new ApprovalError("STILLS_MISSING");
      if (checked.plan.mode === "code_lab" && !draft.traceId) throw new ApprovalError("TRACE_MISSING");
      const hash = hashPlan(checked.plan);
      if (hash !== body.planHash) throw new ApprovalError("PLAN_STALE");
      const previous = await Job.findOne({ ownerId: auth.user!._id, projectId: project._id, type: "render", "input.draftRevision": body.draftRevision, "input.planHash": hash, "input.output": body.output === "mp4" ? "mp4" : { $ne: "mp4" }, ...(body.output === "mp4" ? { "input.voiceId": voice!.id } : {}), state: { $in: ["queued", "running", "waiting_quota", "succeeded"] } }).session(session);
      if (previous) {
        jobId = previous._id;
        storyboardId = previous.input.storyboardId;
        return;
      }
      const active = await Job.findOne({ projectId: project._id, activeSlot: true, state: { $in: ["queued", "running", "waiting_quota"] } }).session(session);
      if (active) {
        const error = new Error("PROJECT_BUSY") as Error & { jobId?: string };
        error.jobId = String(active._id);
        throw error;
      }
      // Seed the counter from legacy records before incrementing; it never decreases.
      const latest = await Storyboard.findOne({ projectId: project._id }).sort({ version: -1 }).select("version").session(session);
      await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $max: { storyboardVersion: latest?.version ?? 0 } }, { session });
      const updated = await Project.findOneAndUpdate({ _id: project._id, ownerId: auth.user!._id }, { $inc: { storyboardVersion: 1 }, $set: { badge: "rendering" } }, { session, new: true });
      if (!updated) throw new ApprovalError("NOT_FOUND");
      const [storyboard] = await Storyboard.create([{
        ownerId: auth.user!._id, projectId: project._id, version: updated.storyboardVersion,
        schemaVersion: 1, plan: checked.plan, planHash: hash,
        storyHash: hashPlan(checked.plan.scenes.map((scene) => scene.lines.map((line) => line.spoken ?? line.text))),
        traceId: draft.traceId, origin: "approve", approvedAt: new Date(),
        ...(project.seriesId ? { seriesVersion: (await SeriesVersion.findOne({ seriesId: project.seriesId, ownerId: auth.user!._id }).sort({ version: -1 }).select("version").session(session))?.version } : {}),
      }], { session });
      const [job] = await Job.create([{
        ownerId: auth.user!._id, projectId: project._id, type: "render", state: "queued", activeSlot: true,
        input: { storyboardId: storyboard._id, draftRevision: draft.revision, planHash: hash, format: checked.plan.format, output: body.output, ...(body.output === "mp4" ? { voiceId: voice!.id } : {}) },
        stages: body.output === "mp4" ? ["voice", "timeline", "frames", "mix", "qa"].map((name) => ({ name, state: "queued" })) : [{ name: "preview", state: "queued" }], attempts: 0, runAfter: new Date(),
      }], { session });
      jobId = job._id; storyboardId = storyboard._id;
    });
    const job = await Job.findById(jobId);
    return json({ jobId: String(jobId), storyboardId: String(storyboardId), videoId: job?.result?.videoId ? String(job.result.videoId) : undefined }, 202);
  } catch (error) {
    if (error instanceof ApprovalError) {
      if (error.reason === "NOT_FOUND") return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
      if (error.reason === "PLAN_INVALID") return apiError(422, "VALIDATION", "PLAN_INVALID", "The storyboard is not valid yet.");
      if (error.reason === "VOICE_LANGUAGE") return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", "This narrator does not speak the storyboard language.");
      if (error.reason === "STILLS_MISSING") return apiError(422, "VALIDATION", "STILLS_MISSING", "Draw every still before approving this story.");
      if (error.reason === "TRACE_MISSING") return apiError(422, "VALIDATION", "TRACE_MISSING", "Trace the code before approving a Code Lab film.");
      return apiError(409, "CONFLICT", error.reason, error.reason === "PLAN_STALE" ? "The storyboard changed. Approve the latest one." : "This draft changed. Reload it.", error.revision ? { currentRevision: error.revision } : undefined);
    }
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not approve the storyboard.");
  } finally { await session.endSession(); }
}
