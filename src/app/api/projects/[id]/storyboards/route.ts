import { Storyboard } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";

/** Approved storyboard versions, newest first. Each is immutable. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const rows = await Storyboard.find({ projectId: project._id, ownerId: auth.user!._id }).sort({ version: -1 }).limit(50).select("version plan.title plan.scenes.id planHash origin approvedAt briefVersionId seriesVersion");
  return json({
    items: rows.map((row) => ({ id: String(row._id), version: row.version, title: row.plan?.title ?? "", scenes: row.plan?.scenes?.length ?? 0, planHash: row.planHash, origin: row.origin, approvedAt: row.approvedAt, briefVersionId: row.briefVersionId ? String(row.briefVersionId) : null, seriesVersion: row.seriesVersion ?? null })),
  });
}
