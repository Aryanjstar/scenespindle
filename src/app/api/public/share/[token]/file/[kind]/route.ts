import { connectDb } from "../../../../../../../server/db";
import { apiError } from "../../../../../../../server/http";
import { limit } from "../../../../../../../server/rate-limit";
import { serveFile } from "../../../../../../../server/storage";
import { PUBLIC_KINDS, artifactKey, downloadName, sharedVideo, type FileKind } from "../../../../../../../server/videos";

export async function GET(request: Request, ctx: { params: Promise<{ token: string; kind: string }> }) {
  try { await connectDb(); } catch { return apiError(503, "UNAVAILABLE", "DB_DOWN", "This video is not reachable right now."); }
  if (!(await limit(request, "share-file", 600, 60_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many requests. Try again in a minute.");
  const { token, kind } = await ctx.params;
  if (!PUBLIC_KINDS.includes(kind as FileKind)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not available.");
  const found = await sharedVideo(token);
  const key = found ? artifactKey(found.video, kind as FileKind) : null;
  if (!found || !key) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not available.");
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  if (wantsDownload && !found.link.allowDownload) return apiError(403, "FORBIDDEN", "DOWNLOAD_DISABLED", "The creator has not allowed downloads.");
  const response = await serveFile(key, request, wantsDownload ? { download: downloadName(found.title, kind as FileKind, found.video.version) } : {});
  response.headers.set("cache-control", "no-store");
  return response;
}
