import { z } from "zod";
import { Character, Series } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, json } from "../../../server/guard";
import { seriesBody, seriesJson } from "../../../server/series";



export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const items = await Series.find({ ownerId: auth.user!._id, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).limit(50);
  return json({ items: items.map(seriesJson) });
}

export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ ...seriesBody, logline: seriesBody.logline.default(""), mode: seriesBody.mode.default("story"), style: seriesBody.style.default("storybook"), world: seriesBody.world.default(""), tone: seriesBody.tone.default(""), rules: seriesBody.rules.default([]), continuity: seriesBody.continuity.default(""), locations: seriesBody.locations.default([]), castIds: seriesBody.castIds.default([]) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.message ?? "Check the series fields.");
  const body = parsed.data;
  if (body.castIds.length && (await Character.countDocuments({ _id: { $in: body.castIds }, ownerId: auth.user!._id })) !== new Set(body.castIds).size) return apiError(404, "NOT_FOUND", "NOT_FOUND", "A cast member is not in your library.");
  const series = await Series.create({ ownerId: auth.user!._id, title: body.title, logline: body.logline, mode: body.mode, style: body.style, bible: { world: body.world, tone: body.tone, rules: body.rules, continuity: body.continuity, locations: body.locations }, castIds: body.castIds });
  return json({ series: seriesJson(series) }, 201);
}
