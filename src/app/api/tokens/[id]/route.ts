import mongoose from "mongoose";
import { ApiToken } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed } from "../../../../server/guard";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That token is not here.");
  const row = await ApiToken.findOneAndUpdate({ _id: id, ownerId: auth.user!._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  if (!row) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That token is not here.");
  return new Response(null, { status: 204 });
}
