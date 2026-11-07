import { connectDb } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { json } from "../../../../server/guard";
import { agentFromRequest, claimForAgent } from "../../../../server/agents";

/** The paired PC asks for its next job. 204 when there is none. */
export async function POST(request: Request) {
  await connectDb();
  const agent = await agentFromRequest(request);
  if (!agent) return apiError(401, "UNAUTHENTICATED", "AGENT_TOKEN", "This PC is not paired, or it was unpaired.");
  const job = await claimForAgent(agent);
  if (!job) return new Response(null, { status: 204 });
  return json({ job });
}
