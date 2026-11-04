import { connectDb, ShareLink } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { json } from "../../../../../server/guard";
import { limit } from "../../../../../server/rate-limit";
import { sharedVideo } from "../../../../../server/videos";

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  try { await connectDb(); } catch { return apiError(503, "UNAVAILABLE", "DB_DOWN", "This video is not reachable right now."); }
  if (!(await limit(request, "share", 120, 60_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many requests. Try again in a minute.");
  const { token } = await ctx.params;
  const found = await sharedVideo(token);
  if (!found) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not available.");
  await ShareLink.updateOne({ _id: found.link._id }, { $inc: { views: 1 } });
  const base = `/api/public/share/${token}/file`;
  // Public payload: the film only. No owner, project, script or other versions.
  return json({
    title: found.title,
    durationMs: found.video.durationMs ?? 0,
    format: found.video.format,
    videoUrl: `${base}/mp4`,
    posterUrl: `${base}/thumb`,
    captionsUrl: found.video.artifacts?.vtt ? `${base}/vtt` : undefined,
    allowDownload: found.link.allowDownload,
    downloadUrl: found.link.allowDownload ? `${base}/mp4?download=1` : undefined,
  });
}
