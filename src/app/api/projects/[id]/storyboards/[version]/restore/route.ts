import { z } from "zod";
import { Draft, Storyboard } from "../../../../../../../server/db";
import { apiError } from "../../../../../../../server/http";
import { authed, json } from "../../../../../../../server/guard";
import { hashPlan, ownProject } from "../../../../../../../server/studio";
import { validatePlan } from "../../../../../../../contracts/plan";

/** Bring an approved storyboard back as the editable draft. The snapshot itself never changes. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id, version } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project || !/^\d{1,5}$/.test(version)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That storyboard is not here.");
  const parsed = z.object({ expectedRevision: z.number().int().positive() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send the draft revision you are replacing.");
  const snapshot = await Storyboard.findOne({ projectId: project._id, ownerId: auth.user!._id, version: Number(version) });
  if (!snapshot) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That storyboard is not here.");
  const checked = validatePlan(snapshot.plan);
  if (!checked.plan) return apiError(422, "VALIDATION", "PLAN_INVALID", "That storyboard no longer validates.");
  const draft = await Draft.findOneAndUpdate(
    { projectId: project._id, ownerId: auth.user!._id, revision: parsed.data.expectedRevision },
    { $set: { plan: checked.plan, planValid: true, planHash: hashPlan(checked.plan), issues: [], traceId: snapshot.traceId, briefVersionId: snapshot.briefVersionId }, $inc: { revision: 1 } },
    { new: true },
  );
  if (!draft) {
    const current = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id }).select("revision");
    return apiError(409, "CONFLICT", "REVISION_CONFLICT", "The draft changed. Reload, then restore again.", { currentRevision: current?.revision });
  }
  return json({ revision: draft.revision, planHash: draft.planHash });
}
