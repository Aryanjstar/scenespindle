import { z } from "zod";
import { Project, ShareLink, Video } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { newShareToken } from "../../../../../server/studio";
import { isId } from "../../../../../server/videos";
import { appEnv } from "../../../../../config/app";

const bodySchema = z.object({ allowDownload: z.boolean().optional() }).strict();
type Ctx = { params: Promise<{ id: string }> };

async function ownReady(ownerId: unknown, id: string) {
  if (!isId(id)) return null;
  const video = await Video.findOne({ _id: id, ownerId }).select("-previewHtml");
  if (!video) return null;
  const project = await Project.findOne({ _id: video.projectId, ownerId, deletedAt: { $exists: false } }).select("_id");
  return project ? video : null;
}

function link(share: { token: string; allowDownload: boolean; views: number; createdAt?: Date }) {
  return { url: `${appEnv().origin}/v/${share.token}`, allowDownload: share.allowDownload, views: share.views, createdAt: share.createdAt };
}

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const video = await ownReady(auth.user!._id, id);
  if (!video) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  const share = await ShareLink.findOne({ videoId: video._id, ownerId: auth.user!._id, revokedAt: { $exists: false } });
  return json({ share: share ? link(share) : null });
}

export async function POST(request: Request, ctx: Ctx) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Only allowDownload can be set.");
  const video = await ownReady(auth.user!._id, id);
  if (!video) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  if (video.state !== "ready" || video.kind !== "mp4") return apiError(422, "VALIDATION", "NOT_SHAREABLE", "Only a finished film that passed QA can be shared. Previews stay private.");
  const share = await ShareLink.findOneAndUpdate(
    { videoId: video._id, ownerId: auth.user!._id, revokedAt: { $exists: false } },
    {
      $setOnInsert: { token: newShareToken(), projectId: video.projectId, views: 0 },
      $set: { allowDownload: parsed.data.allowDownload ?? false },
    },
    { upsert: true, new: true },
  );
  return json({ share: link(share) }, 201);
}

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!isId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That video is not here.");
  await ShareLink.updateMany({ videoId: id, ownerId: auth.user!._id, revokedAt: { $exists: false } }, { revokedAt: new Date() });
  return new Response(null, { status: 204 });
}
