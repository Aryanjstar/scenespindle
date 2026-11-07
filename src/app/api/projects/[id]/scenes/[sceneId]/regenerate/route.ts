import { z } from "zod";
import { Draft, Message } from "../../../../../../../server/db";
import { apiError } from "../../../../../../../server/http";
import { authed, busy, json } from "../../../../../../../server/guard";
import { enqueue } from "../../../../../../../server/jobs";
import { limit } from "../../../../../../../server/rate-limit";
import { ownProject } from "../../../../../../../server/studio";

/** Rewrite one scene. The result arrives as a copilot proposal you keep or discard. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id, sceneId } = await ctx.params;
  if (!/^s\d{1,2}$/.test(sceneId)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That scene is not here.");
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const parsed = z.object({ note: z.string().trim().max(600).default("") }).strict().safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Add an optional note of up to 600 characters.");
  if (!(await limit(request, "plan", 20, 10 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of changes in a short time. Wait a few minutes.");
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id });
  if (!draft?.plan?.scenes?.some((scene: { id: string }) => scene.id === sceneId)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That scene is not here.");
  const text = parsed.data.note ? `Rewrite this scene: ${parsed.data.note}` : "Rewrite this scene with fresher wording and a stronger on-screen line. Keep its role in the film.";
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "scene_regen", input: { text, draftRevision: draft.revision, sceneIds: [sceneId] }, stages: ["scene_regen"] });
    const updated = await Draft.findOneAndUpdate({ _id: draft._id, ownerId: auth.user!._id }, { $inc: { messageSeq: 1 } }, { new: true });
    await Message.create({ ownerId: auth.user!._id, projectId: project._id, seq: updated!.messageSeq, role: "user", text: `Regenerate ${sceneId}${parsed.data.note ? `: ${parsed.data.note}` : ""}`, sceneIds: [sceneId], jobId });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start that.");
  }
}
