import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { Character, connectDb, Draft, Job, Project, ShareLink, Video } from "../../../../server/db";
import { videoJson } from "../../../../server/videos";
import { apiError, originOk } from "../../../../server/http";
import { currentUser } from "../../../../server/session";
import { FORMATS, LANGUAGES, validatePlan } from "../../../../contracts/plan";
import { hashPlan } from "../../../../server/studio";
import { z } from "zod";
import { loadEnv } from "../../../../config/env";
import { voiceEntry, voiceUnavailable } from "../../../../config/providers";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  voiceId: z.string().max(80).optional(),
  format: z.enum(FORMATS).optional(),
  language: z.enum(LANGUAGES).optional(),
  targetMs: z.number().int().min(15000).max(180000).optional(),
  castIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(6).optional(),
  look: z.enum(["stage", "illustrated"]).optional(),
  executionTarget: z.enum(["hosted", "paired-agent"]).optional(),
  renderProfile: z.enum(["realtime-3d", "cinematic-3d"]).optional(),
  recap: z.string().trim().max(600).optional(),
}).strict();

function projectJson(project: { _id: unknown; title: string; mode: string; format: string; targetMs: number; language: string; voiceId: string; styleId: string; badge: string; updatedAt?: Date; castIds?: unknown[]; seriesId?: unknown; seriesVersion?: number; episodeNumber?: number; lyrics?: { songAssetId?: unknown; lrc?: string } | null; look?: string; executionTarget?: string; renderProfile?: string; recap?: string; montage?: unknown }) {
  return {
    id: String(project._id), title: project.title, mode: project.mode, format: project.format, targetMs: project.targetMs, language: project.language,
    voiceId: project.voiceId, styleId: project.styleId, badge: project.badge, updatedAt: project.updatedAt, castIds: (project.castIds ?? []).map(String),
    seriesId: project.seriesId ? String(project.seriesId) : null, seriesVersion: project.seriesVersion ?? null, episodeNumber: project.episodeNumber ?? null,
    lyrics: project.lyrics?.songAssetId ? { songAssetId: String(project.lyrics.songAssetId), lrc: project.lyrics.lrc ?? "" } : null,
    look: project.look ?? "stage", executionTarget: project.executionTarget ?? "hosted", renderProfile: project.renderProfile ?? "realtime-3d", recap: project.recap ?? "", montage: project.montage ?? null,
  };
}

type Ctx = { params: Promise<{ id: string }> };

function missing() {
  return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await connectDb();
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
  const user = await currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return missing();
  try {
    const project = await Project.findOne({ _id: id, ownerId: user._id }).maxTimeMS(8_000);
    if (!project) return missing();
    const draft = await Draft.findOne({ projectId: project._id, ownerId: user._id }).maxTimeMS(8_000);
    const video = project.currentVideoId
      ? await Video.findOne({ _id: project.currentVideoId, ownerId: user._id }).select("-previewHtml")
      : await Video.findOne({ projectId: project._id, ownerId: user._id, state: { $in: ["preview", "ready"] } }).sort({ version: -1 }).select("-previewHtml");
    const activeJob = await Job.findOne({ projectId: project._id, ownerId: user._id, activeSlot: true }).select("_id type state input.output");
    return NextResponse.json({
      project: projectJson(project),
      draft: draft
        ? {
            id: String(draft._id),
            revision: draft.revision,
            idea: draft.idea,
            plan: draft.plan,
            planHash: draft.planHash,
            planValid: draft.planValid,
            issues: draft.issues ?? (draft.plan != null ? validatePlan(draft.plan).issues : []),
            traceId: draft.traceId ? String(draft.traceId) : undefined,
            briefVersionId: draft.briefVersionId ? String(draft.briefVersionId) : null,
          }
        : null,
      video: video ? videoJson(video, project.currentVideoId) : null,
      activeJob: activeJob ? { id: String(activeJob._id), type: activeJob.type, state: activeJob.state, output: activeJob.type !== "render" ? activeJob.type : activeJob.input?.output === "mp4" ? "mp4" : activeJob.input?.output === "montage" ? "montage" : "preview" } : null,
    });
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  try {
    await connectDb();
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
  const user = await currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return missing();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !Object.keys(parsed.data).length) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.success ? "Send at least one setting to change." : `Check ${parsed.error.issues[0]?.path.join(".") || "the settings"}: ${parsed.error.issues[0]?.message ?? "invalid"}.`);
  const before = await Project.findOne({ _id: id, ownerId: user._id });
  if (!before) return missing();
  if (parsed.data.voiceId) {
    const voice = voiceEntry(parsed.data.voiceId);
    if (!voice) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", "That narrator is not in the catalog.");
    const blocked = voiceUnavailable(voice, loadEnv(), parsed.data.language ?? before.language);
    if (blocked) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", blocked);
  }
  if (parsed.data.castIds?.length && (await Character.countDocuments({ _id: { $in: parsed.data.castIds }, ownerId: user._id })) !== new Set(parsed.data.castIds).size) {
    return apiError(404, "NOT_FOUND", "NOT_FOUND", "A cast member is not in your library.");
  }
  const project = await Project.findOneAndUpdate({ _id: id, ownerId: user._id }, { $set: parsed.data }, { new: true });
  if (!project) return missing();
  // Format is presentation only: carry it into a valid draft plan so the next approval uses it.
  let draftRevision: number | undefined;
  if (parsed.data.format) {
    const draft = await Draft.findOne({ projectId: project._id, ownerId: user._id, planValid: true });
    const checked = draft ? validatePlan({ ...draft.plan, format: parsed.data.format }) : null;
    if (draft && checked?.plan && draft.plan?.format !== parsed.data.format) {
      const updated = await Draft.findOneAndUpdate(
        { _id: draft._id, ownerId: user._id, revision: draft.revision },
        { $set: { plan: checked.plan, planHash: hashPlan(checked.plan) }, $inc: { revision: 1 } },
        { new: true },
      );
      draftRevision = updated?.revision;
    }
  }
  return NextResponse.json({
    project: projectJson(project),
    draftRevision,
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  try {
    await connectDb();
  } catch {
    return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable.");
  }
  const user = await currentUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "NO_SESSION", "Sign in to open the studio.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return missing();
  // Soft delete: hide now, revoke shares, cancel work. Data is kept 7 days for recovery.
  const project = await Project.findOneAndUpdate({ _id: id, ownerId: user._id }, { $set: { deletedAt: new Date() } }, { new: true });
  if (!project) return missing();
  await ShareLink.updateMany({ projectId: project._id, ownerId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  await Job.updateMany(
    { projectId: project._id, ownerId: user._id, state: { $in: ["queued", "running", "waiting_quota"] } },
    { $set: { state: "cancelled", finishedAt: new Date() }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } },
  );
  return new NextResponse(null, { status: 204 });
}
