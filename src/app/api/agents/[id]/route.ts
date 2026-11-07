import mongoose from "mongoose";
import { Agent, Job } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";

/** Unpair a PC. Its token stops working at once and its running job goes back to the queue. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That PC is not here.");
  const agent = await Agent.findOneAndUpdate({ _id: id, ownerId: auth.user!._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() }, $unset: { tokenHash: 1, pairingHash: 1 } }, { new: true });
  if (!agent) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That PC is not here.");
  await Job.updateMany({ ownerId: auth.user!._id, agentId: agent._id, state: "running" }, { $set: { state: "queued", runAfter: new Date() }, $unset: { leaseToken: 1, leaseExpiresAt: 1, agentId: 1 } });
  return json({ revoked: true });
}
