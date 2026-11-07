import { Project, Video } from "../../../../../../server/db";
import { apiError } from "../../../../../../server/http";
import { authed } from "../../../../../../server/guard";
import { serveFile } from "../../../../../../server/storage";
import { isId } from "../../../../../../server/videos";

const NAMES: Record<string, string> = { audio: "audio.m4a", package: "package.zip", otio: "timeline.otio" };

/** Download an export file. Owner-only. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id, kind } = await ctx.params;
  if (!isId(id) || !NAMES[kind]) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const video = await Video.findOne({ _id: id, ownerId: auth.user!._id }).select("exports projectId version");
  const key = video?.exports?.[kind];
  if (!video || !key) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const project = await Project.findOne({ _id: video.projectId, ownerId: auth.user!._id }).select("title");
  const base = (project?.title ?? "film").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60) || "film";
  return serveFile(key, request, { download: `${base}-v${video.version}-${NAMES[kind]}` });
}
