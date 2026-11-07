import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { enqueue } from "../../../../../server/jobs";
import { limit } from "../../../../../server/rate-limit";
import { ownProject } from "../../../../../server/studio";

/** Queue a brainstorm. The angles arrive in the job result; poll GET /api/jobs/{jobId}. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (!(await limit(request, "plan", 20, 10 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of planning in a short time. Wait a few minutes.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "brainstorm", input: {}, stages: ["brainstorm"] });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not brainstorm.");
  }
}
