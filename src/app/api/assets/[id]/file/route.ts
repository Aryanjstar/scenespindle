import mongoose from "mongoose";
import { Asset } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed } from "../../../../../server/guard";
import { connectDb } from "../../../../../server/db";
import { verifyAssetSignature } from "../../../../../server/signed";
import { serveFile } from "../../../../../server/storage";

/**
 * Owner-only access to a library file (uploads, character sheets, story stills). Previews in a
 * sandboxed frame use a short-lived signed URL instead of the session cookie.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const url = new URL(request.url);
  let asset;
  if (url.searchParams.has("sig")) {
    const scope = verifyAssetSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"), url.searchParams.get("scope"));
    if (!scope) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
    await connectDb();
    asset = await Asset.findOne(scope === "agent" ? { _id: id } : { _id: id, kind: "image" });
  } else {
    const auth = await authed();
    if ("error" in auth && auth.error) return auth.error;
    asset = await Asset.findOne({ _id: id, ownerId: auth.user!._id, deletedAt: { $exists: false } });
  }
  if (!asset || asset.path.startsWith("/")) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  return serveFile(asset.path, request, url.searchParams.get("download") === "1" ? { download: asset.name } : {});
}
