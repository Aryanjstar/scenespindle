import mongoose from "mongoose";
import { z } from "zod";
import { connectDb, Job } from "../../../../../../server/db";
import { apiError } from "../../../../../../server/http";
import { json } from "../../../../../../server/guard";
import { AGENT_LEASE_MS, agentFromRequest, agentHeld } from "../../../../../../server/agents";

/** Progress from the PC; also renews its lease. 409 means stop: the job was cancelled or reassigned. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connectDb();
  const agent = await agentFromRequest(request);
  if (!agent) return apiError(401, "UNAUTHENTICATED", "AGENT_TOKEN", "This PC is not paired, or it was unpaired.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  const parsed = z.object({ leaseToken: z.string().uuid(), stages: z.array(z.object({ name: z.string().max(20), state: z.enum(["queued", "running", "done"]) })).max(8), progress: z.number().int().min(0).max(100) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send leaseToken, stages and progress.");
  const updated = await Job.updateOne(agentHeld(id, agent._id, agent.ownerId, parsed.data.leaseToken), { $set: { stages: parsed.data.stages, progress: parsed.data.progress, leaseExpiresAt: new Date(Date.now() + AGENT_LEASE_MS) } });
  if (!updated.modifiedCount) return apiError(409, "CONFLICT", "LEASE_LOST", "Stop: this job was cancelled or given to another worker.");
  return json({ ok: true });
}
