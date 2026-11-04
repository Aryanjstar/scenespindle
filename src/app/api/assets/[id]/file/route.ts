import mongoose from "mongoose";
import { Asset } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed } from "../../../../../server/guard";
import { serveFile } from "../../../../../server/storage";

/** Owner-only access to a library file (uploads, character sheets, story stills). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const asset = await Asset.findOne({ _id: id, ownerId: auth.user!._id });
  if (!asset || asset.path.startsWith("/")) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  return serveFile(asset.path, request, new URL(request.url).searchParams.get("download") === "1" ? { download: asset.name } : {});
}
