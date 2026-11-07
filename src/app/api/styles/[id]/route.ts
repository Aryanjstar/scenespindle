import mongoose from "mongoose";
import { Style } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That style is not here.");
  const result = await Style.deleteOne({ _id: id, ownerId: auth.user!._id });
  if (!result.deletedCount) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That style is not here.");
  return json({ deleted: true });
}
