import { Draft } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { PREVIEW_CSP, signPreviewImages } from "../../../../../server/signed";
import { authed } from "../../../../../server/guard";
import { ownProject, previewHtml } from "../../../../../server/studio";
import { validatePlan } from "../../../../../contracts/plan";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id });
  const checked = validatePlan(draft?.plan);
  if (!checked.plan) return apiError(422, "VALIDATION", "PLAN_INVALID", "The storyboard is not valid yet.");
  const html = previewHtml(checked.plan);
  return new Response(signPreviewImages(html), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "x-content-type-options": "nosniff",
    },
  });
}
