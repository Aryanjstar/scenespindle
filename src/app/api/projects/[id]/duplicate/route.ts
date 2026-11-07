import mongoose from "mongoose";
import { Draft, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";

/** Copy a project's settings and current draft into a new project. Films and shares are not copied. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const source = await ownProject(auth.user!._id, id);
  if (!source) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const draft = await Draft.findOne({ projectId: source._id, ownerId: auth.user!._id });
  const session = await mongoose.startSession();
  try {
    let newId = "";
    await session.withTransaction(async () => {
      const [copy] = await Project.create([{
        ownerId: auth.user!._id, title: `${source.title} (copy)`.slice(0, 120), mode: source.mode, format: source.format, targetMs: source.targetMs,
        language: source.language, voiceId: source.voiceId, styleId: source.styleId, keepPrivate: source.keepPrivate, badge: draft?.plan ? "review" : "draft",
        castIds: source.castIds, look: source.look, executionTarget: source.executionTarget, montage: source.montage, lyrics: source.lyrics, duplicatedFrom: source._id,
      }], { session });
      await Draft.create([{
        ownerId: auth.user!._id, projectId: copy._id, revision: 1, idea: draft?.idea ?? { topic: "" },
        plan: draft?.plan, planHash: draft?.planHash, planValid: draft?.planValid ?? false, issues: draft?.issues, traceId: draft?.traceId,
      }], { session });
      newId = String(copy._id);
    });
    return json({ project: { id: newId } }, 201);
  } finally {
    await session.endSession();
  }
}
