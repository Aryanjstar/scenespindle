import mongoose from "mongoose";
import { z } from "zod";
import { connectDb, Job, Project } from "../../../../../../server/db";
import { apiError } from "../../../../../../server/http";
import { json } from "../../../../../../server/guard";
import { agentFromRequest, agentHeld } from "../../../../../../server/agents";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connectDb();
  const agent = await agentFromRequest(request);
  if (!agent) return apiError(401, "UNAUTHENTICATED", "AGENT_TOKEN", "This PC is not paired, or it was unpaired.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  const parsed = z.object({ leaseToken: z.string().uuid(), message: z.string().max(300), retryable: z.boolean().default(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send leaseToken and a short message.");
  const job = await Job.findOneAndUpdate(agentHeld(id, agent._id, agent.ownerId, parsed.data.leaseToken), { $set: { state: "failed", finishedAt: new Date(), error: { code: "AGENT_RENDER_FAILED", message: `Your PC could not render this: ${parsed.data.message.replaceAll(/[\r\n]+/g, " ")}`, retryable: parsed.data.retryable } }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } }, { new: true });
  if (!job) return apiError(409, "CONFLICT", "LEASE_LOST", "This job is no longer yours.");
  await Project.updateOne({ _id: job.projectId, ownerId: agent.ownerId, badge: "rendering" }, { $set: { badge: "review" } });
  return json({ ok: true });
}
