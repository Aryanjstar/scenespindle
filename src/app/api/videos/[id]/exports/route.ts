import { z } from "zod";
import { Video } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { enqueue } from "../../../../../server/jobs";
import { isId } from "../../../../../server/videos";

/**
 * Export a finished film. mp4, srt and vtt are ready at once; audio, package (zip with storyboard,
 * captions, OTIO and manifest) and otio are made in the worker the first time, then reused.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  const parsed = z.object({ kind: z.enum(["mp4", "srt", "vtt", "audio", "package", "otio"]) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose mp4, srt, vtt, audio, package or otio.");
  const video = await Video.findOne({ _id: id, ownerId: auth.user!._id }).select("state kind artifacts exports");
  if (!video) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  if (video.state !== "ready" || video.kind !== "mp4") return apiError(422, "VALIDATION", "NOT_EXPORTABLE", "Only a finished film that passed QA can be exported.");
  const kind = parsed.data.kind;
  if (kind === "mp4" || kind === "srt" || kind === "vtt") {
    if (!video.artifacts?.[kind]) return apiError(404, "NOT_FOUND", "NOT_FOUND", "This film has no file of that kind.");
    return json({ kind, url: `/api/videos/${id}/file/${kind}?download=1` });
  }
  if (video.exports?.[kind]) return json({ kind, url: `/api/videos/${id}/exports/${kind}` });
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: video._id, type: "export", input: { videoId: id, kind }, stages: ["export"] });
    return json({ kind, jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start the export.");
  }
}
