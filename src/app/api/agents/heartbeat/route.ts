import { z } from "zod";
import { Agent, connectDb } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { json } from "../../../../server/guard";
import { agentFromRequest } from "../../../../server/agents";

export async function POST(request: Request) {
  await connectDb();
  const agent = await agentFromRequest(request);
  if (!agent) return apiError(401, "UNAUTHENTICATED", "AGENT_TOKEN", "This PC is not paired, or it was unpaired.");
  const parsed = z.object({ capabilities: z.object({ ffmpeg: z.boolean(), chrome: z.boolean(), blender: z.boolean(), os: z.string().max(40), version: z.string().max(40) }).partial().strict().optional() }).strict().safeParse(await request.json().catch(() => ({})));
  if (parsed.success && parsed.data.capabilities) await Agent.updateOne({ _id: agent._id }, { $set: { capabilities: parsed.data.capabilities } });
  return json({ ok: true, name: agent.name });
}
