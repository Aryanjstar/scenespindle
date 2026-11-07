import { Draft, Message } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { z } from "zod";
import { enqueue } from "../../../../../server/jobs";
import { limit } from "../../../../../server/rate-limit";
import { ownProject } from "../../../../../server/studio";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const items = await Message.find({ projectId: project._id, ownerId: auth.user!._id }).sort({ seq: 1 }).limit(40);
  return json({
    items: items.map((item) => ({
      id: String(item._id),
      seq: item.seq,
      role: item.role,
      text: item.text,
      sceneIds: item.sceneIds,
      candidate: item.candidate ? { summary: item.candidate.summary, changedSceneIds: item.candidate.changedSceneIds, changeClass: item.candidate.changeClass, status: item.candidate.status } : undefined,
    })),
  });
}

const body = z.object({ text: z.string().trim().min(1).max(4000), sceneIds: z.array(z.string().regex(/^s\d{1,2}$/)).max(40).default([]) }).strict();

/** Ask the copilot. The user's note is saved now; the worker posts the reply and proposal. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "VALIDATION", "Write a note for the copilot.");
  if (!(await limit(request, "plan", 20, 10 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of changes in a short time. Wait a few minutes.");
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id });
  if (!draft) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "revise", input: { text: parsed.data.text, draftRevision: draft.revision, sceneIds: parsed.data.sceneIds }, stages: ["revise"] });
    const updated = await Draft.findOneAndUpdate({ _id: draft._id, ownerId: auth.user!._id }, { $inc: { messageSeq: 1 } }, { new: true });
    const message = await Message.create({ ownerId: auth.user!._id, projectId: project._id, seq: updated!.messageSeq, role: "user", text: parsed.data.text, sceneIds: parsed.data.sceneIds, jobId });
    return json({ message: { id: String(message._id) }, jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "The copilot could not start.");
  }
}
