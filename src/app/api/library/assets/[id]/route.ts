import mongoose from "mongoose";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { assetUses, softDeleteAsset } from "../../../../../server/asset-refs";

/** Delete a library file if nothing uses it. The file is erased by the retention sweep. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  const uses = await assetUses(auth.user!._id, id);
  if (uses.length) return apiError(409, "CONFLICT", "ASSET_IN_USE", `This file is used by ${uses.join(", ")}. Remove it there first.`, { uses });
  const asset = await softDeleteAsset(auth.user!._id, id);
  if (!asset) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That file is not here.");
  return json({ deleted: true });
}
