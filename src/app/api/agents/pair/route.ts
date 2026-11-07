import { z } from "zod";
import { Agent, connectDb } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { json } from "../../../../server/guard";
import { limit } from "../../../../server/rate-limit";
import { agentJson, newAgentToken } from "../../../../server/agents";
import { hashToken } from "../../../../server/session";

const capabilities = z.object({ ffmpeg: z.boolean(), chrome: z.boolean(), blender: z.boolean(), os: z.string().max(40), version: z.string().max(40) }).partial().strict();

/** The PC redeems its one-time code for its own token. The token is shown once. */
export async function POST(request: Request) {
  await connectDb();
  if (!(await limit(request, "agent-pair", 10, 60 * 60_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many pairing attempts. Try again later.");
  const parsed = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/), capabilities: capabilities.default({}) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_CODE", "Enter the 10-character pairing code from Settings.");
  const token = newAgentToken();
  const agent = await Agent.findOneAndUpdate(
    { pairingHash: hashToken(parsed.data.code), pairingExpiresAt: { $gt: new Date() }, revokedAt: { $exists: false }, tokenHash: { $exists: false } },
    { $set: { tokenHash: hashToken(token), capabilities: parsed.data.capabilities, lastSeenAt: new Date() }, $unset: { pairingHash: 1, pairingExpiresAt: 1 } },
    { new: true },
  );
  if (!agent) return apiError(404, "NOT_FOUND", "INVALID_CODE", "That code is not valid or has expired. Make a new one in Settings.");
  return json({ agent: agentJson(agent), token }, 201);
}
