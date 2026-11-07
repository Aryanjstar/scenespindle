import { z } from "zod";
import { Agent } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, json } from "../../../server/guard";
import { agentJson, newPairingCode } from "../../../server/agents";
import { hashToken } from "../../../server/session";

/** Your paired PCs. */
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const items = await Agent.find({ ownerId: auth.user!._id, revokedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(20);
  return json({ items: items.map(agentJson) });
}

/** Start pairing a PC. The code is shown once and works for 15 minutes. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Name the PC, like Studio laptop.");
  if ((await Agent.countDocuments({ ownerId: auth.user!._id, revokedAt: { $exists: false } })) >= 5) return apiError(422, "VALIDATION", "TOO_MANY_AGENTS", "Remove a paired PC before adding another.");
  const code = newPairingCode();
  const agent = await Agent.create({ ownerId: auth.user!._id, name: parsed.data.name, pairingHash: hashToken(code), pairingExpiresAt: new Date(Date.now() + 15 * 60_000), expiresAt: new Date(Date.now() + 90 * 86_400_000), scopes: ["render"] });
  return json({ agent: agentJson(agent), code }, 201);
}
