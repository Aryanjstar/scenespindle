import mongoose from "mongoose";
import { Video } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { PREVIEW_CSP, signPreviewImages } from "../../../../../server/signed";
import { authed } from "../../../../../server/guard";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  const video = await Video.findOne({ _id: id, ownerId: auth.user!._id, state: { $in: ["preview", "ready"] } });
  if (!video?.previewHtml) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  return new Response(signPreviewImages(video.previewHtml), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "x-content-type-options": "nosniff",
    },
  });
}
