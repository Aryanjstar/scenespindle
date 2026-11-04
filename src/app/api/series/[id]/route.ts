import mongoose from "mongoose";
import { z } from "zod";
import { Character, Project, Series, SeriesVersion } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";
import { seriesBody, seriesJson } from "../../../../server/series";

type Ctx = { params: Promise<{ id: string }> };
const missing = () => apiError(404, "NOT_FOUND", "NOT_FOUND", "That series is not here.");

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return missing();
  const series = await Series.findOne({ _id: id, ownerId: auth.user!._id, deletedAt: { $exists: false } });
  if (!series) return missing();
  const episodes = await Project.find({ ownerId: auth.user!._id, seriesId: series._id }).sort({ episodeNumber: 1 }).select("title episodeNumber badge currentVideoId mode");
  const versions = await SeriesVersion.find({ ownerId: auth.user!._id, seriesId: series._id }).sort({ version: -1 }).select("version createdAt");
  const cast = await Character.find({ _id: { $in: series.castIds }, ownerId: auth.user!._id }).select("name sheetAssetId state version");
  return json({
    series: seriesJson(series),
    cast: cast.map((member) => ({ id: String(member._id), name: member.name, state: member.state, version: member.version, sheetUrl: member.sheetAssetId ? `/api/assets/${String(member.sheetAssetId)}/file` : null })),
    episodes: episodes.map((ep) => ({ id: String(ep._id), title: ep.title, episodeNumber: ep.episodeNumber, badge: ep.badge, poster: ep.currentVideoId ? `/api/videos/${String(ep.currentVideoId)}/file/thumb` : null })),
    versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt })),
  });
}

/** Revision-checked edit of the bible and cast. Approved snapshots and old episodes are untouched. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return missing();
  const parsed = z.object({ expectedRevision: z.number().int().positive(), ...Object.fromEntries(Object.entries(seriesBody).map(([key, schema]) => [key, schema.optional()])) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.message ?? "Check the series fields.");
  const { expectedRevision, world, tone, rules, castIds, ...rest } = parsed.data as Record<string, unknown> & { expectedRevision: number; world?: string; tone?: string; rules?: string[]; castIds?: string[] };
  if (castIds?.length && (await Character.countDocuments({ _id: { $in: castIds }, ownerId: auth.user!._id })) !== new Set(castIds).size) return apiError(404, "NOT_FOUND", "NOT_FOUND", "A cast member is not in your library.");
  const set: Record<string, unknown> = { ...rest };
  if (world !== undefined) set["bible.world"] = world;
  if (tone !== undefined) set["bible.tone"] = tone;
  if (rules !== undefined) set["bible.rules"] = rules;
  if (castIds !== undefined) set.castIds = castIds;
  const series = await Series.findOneAndUpdate({ _id: id, ownerId: auth.user!._id, revision: expectedRevision, deletedAt: { $exists: false } }, { $set: set, $inc: { revision: 1 } }, { new: true });
  if (!series) {
    const current = await Series.findOne({ _id: id, ownerId: auth.user!._id }).select("revision");
    return current ? apiError(409, "CONFLICT", "REVISION_CONFLICT", "This series changed. Reload it.", { currentRevision: current.revision }) : missing();
  }
  return json({ series: seriesJson(series) });
}
