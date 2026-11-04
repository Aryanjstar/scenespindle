import mongoose from "mongoose";
import { z } from "zod";
import { Draft, Project, Series, SeriesVersion } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";

/** Start the next episode: a project in the series' mode with its cast, numbered in order. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That series is not here.");
  const parsed = z.object({ topic: z.string().trim().min(3).max(2000), title: z.string().trim().max(120).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Describe what happens in this episode.");
  const series = await Series.findOne({ _id: id, ownerId: auth.user!._id, deletedAt: { $exists: false } });
  if (!series) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That series is not here.");
  if (!(await SeriesVersion.exists({ seriesId: series._id, ownerId: auth.user!._id }))) return apiError(422, "VALIDATION", "SERIES_NOT_APPROVED", "Approve the series bible and cast before making episodes.");
  const session = await mongoose.startSession();
  try {
    let projectId = "";
    let episodeNumber = 0;
    await session.withTransaction(async () => {
      const last = await Project.findOne({ ownerId: auth.user!._id, seriesId: series._id }, null, { withDeleted: true }).sort({ episodeNumber: -1 }).select("episodeNumber").session(session);
      episodeNumber = (last?.episodeNumber ?? 0) + 1;
      const title = parsed.data.title || `${series.title}: Episode ${episodeNumber}`;
      const [project] = await Project.create([{ ownerId: auth.user!._id, title: title.slice(0, 120), mode: series.mode, format: "9x16", targetMs: 60000, language: "en", voiceId: "elevenlabs:alice", styleId: "chalk-and-chai@1", keepPrivate: false, badge: "draft", seriesId: series._id, episodeNumber, castIds: series.castIds }], { session });
      await Draft.create([{ ownerId: auth.user!._id, projectId: project._id, idea: { topic: parsed.data.topic, mustInclude: [] } }], { session });
      projectId = String(project._id);
    });
    return json({ project: { id: projectId, episodeNumber } }, 201);
  } finally {
    await session.endSession();
  }
}
