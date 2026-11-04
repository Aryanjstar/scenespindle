import { Project, Video } from "../../../../../../server/db";
import { apiError } from "../../../../../../server/http";
import { authed } from "../../../../../../server/guard";
import { serveFile } from "../../../../../../server/storage";
import { FILE_KINDS, artifactKey, downloadName, isId, type FileKind } from "../../../../../../server/videos";

export async function GET(request: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id, kind } = await ctx.params;
  if (!isId(id) || !FILE_KINDS.includes(kind as FileKind)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const video = await Video.findOne({ _id: id, ownerId: auth.user!._id, kind: "mp4" });
  const key = video ? artifactKey(video, kind as FileKind) : null;
  if (!video || !key) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const project = await Project.findOne({ _id: video.projectId, ownerId: auth.user!._id, deletedAt: { $exists: false } }).select("title");
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const download = new URL(request.url).searchParams.get("download") === "1";
  return serveFile(key, request, download ? { download: downloadName(project.title, kind as FileKind, video.version) } : {});
}
