import { Project, Video } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { isId } from "../../../../../server/videos";

/** Make an earlier film the current one. Only a finished film that passed QA qualifies. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  const video = await Video.findOne({ _id: id, ownerId: auth.user!._id }).select("projectId state kind qa");
  if (!video) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  if (video.state !== "ready" || video.kind !== "mp4" || video.qa?.passed !== true) return apiError(422, "VALIDATION", "NOT_QA_PASSED", "Only a finished film that passed QA can be the current video.");
  const project = await Project.findOneAndUpdate({ _id: video.projectId, ownerId: auth.user!._id }, { $set: { currentVideoId: video._id, badge: "ready" } }, { new: true });
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  return json({ currentVideoId: String(video._id) });
}
