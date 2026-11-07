import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { Draft, Project } from "../../../../../server/db";
import { enqueue } from "../../../../../server/jobs";
import { limit } from "../../../../../server/rate-limit";
import { ownProject } from "../../../../../server/studio";

/** Queue planning. The worker plans from the frozen draft revision; poll GET /api/jobs/{jobId}. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode === "lyrics" || project.mode === "montage") return apiError(422, "VALIDATION", "WRONG_MODE", project.mode === "lyrics" ? "Lyric storyboards come from your song and lyric file." : "Montages are made from your clips.");
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id });
  if (!draft?.idea?.topic?.trim()) return apiError(400, "VALIDATION", "VALIDATION", "Write a topic before planning.");
  if (project.mode === "code_lab" && !draft.traceId) return apiError(400, "VALIDATION", "VALIDATION", "Trace the code before planning a Code Lab film.");
  if (!(await limit(request, "plan", 20, 10 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of planning in a short time. Wait a few minutes.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "plan", input: { draftRevision: draft.revision }, stages: ["plan"] });
    await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { badge: "planning" } });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start planning.");
  }
}
