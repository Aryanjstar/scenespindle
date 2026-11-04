import { Video } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";
import { videoJson } from "../../../../../server/videos";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const videos = await Video.find({ projectId: project._id, ownerId: auth.user!._id }).sort({ version: -1 }).limit(50).select("-previewHtml");
  return json({ items: videos.map((video) => videoJson(video, project.currentVideoId)), currentVideoId: project.currentVideoId ? String(project.currentVideoId) : null });
}
