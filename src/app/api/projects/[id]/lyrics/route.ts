import { z } from "zod";
import { Asset, Draft, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { hashPlan, ownProject } from "../../../../../server/studio";
import { lyricsPlan } from "../../../../../pipeline/lyrics";
import { FORMATS, LANGUAGES, type Format, type Language } from "../../../../../contracts/plan";

const bodySchema = z.object({ songAssetId: z.string().regex(/^[a-f0-9]{24}$/), lrc: z.string().min(8).max(20000), expectedRevision: z.number().int().positive() }).strict();

/** Build a lyric storyboard from your song and timed lyrics. Every time comes from the lyric file. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "lyrics") return apiError(422, "VALIDATION", "WRONG_MODE", "Lyric storyboards are made in a Lyrics project.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose a song and paste timed lyrics (LRC).");
  if (!(await Asset.exists({ _id: parsed.data.songAssetId, ownerId: auth.user!._id, kind: "audio" }))) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That song is not in your library.");
  let plan;
  try {
    plan = lyricsPlan({ title: project.title, lrc: parsed.data.lrc, songAssetId: parsed.data.songAssetId, language: ((LANGUAGES as readonly string[]).includes(project.language) ? project.language : "en") as Language, format: ((FORMATS as readonly string[]).includes(project.format) ? project.format : "9x16") as Format });
  } catch (error) {
    return apiError(422, "VALIDATION", "LYRICS_INVALID", error instanceof Error ? error.message : "Those lyrics could not be read.");
  }
  const draft = await Draft.findOneAndUpdate(
    { projectId: project._id, ownerId: auth.user!._id, revision: parsed.data.expectedRevision },
    { $set: { plan, planValid: true, planHash: hashPlan(plan), issues: [] }, $inc: { revision: 1 } },
    { new: true },
  );
  if (!draft) return apiError(409, "CONFLICT", "REVISION_CONFLICT", "This draft changed. Reload it.");
  await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { lyrics: { songAssetId: parsed.data.songAssetId, lrc: parsed.data.lrc }, badge: "review" } });
  return json({ revision: draft.revision, planHash: draft.planHash, lines: plan.scenes.reduce((sum, scene) => sum + scene.lines.length, 0), scenes: plan.scenes.length });
}
