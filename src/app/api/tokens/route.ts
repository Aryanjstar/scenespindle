import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiToken } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, json } from "../../../server/guard";
import { hashToken } from "../../../server/session";

/** Personal API tokens: the CLI and AI IDEs act as you through the same API the studio uses. */
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const rows = await ApiToken.find({ ownerId: auth.user!._id }).sort({ createdAt: -1 }).limit(50);
  return json({ items: rows.map((row) => ({ id: String(row._id), name: row.name, prefix: row.prefix, lastUsedAt: row.lastUsedAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt, createdAt: row.createdAt })) });
}

export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(60), days: z.number().int().min(1).max(365).default(90) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Give the token a name and a lifetime of 1 to 365 days.");
  if ((await ApiToken.countDocuments({ ownerId: auth.user!._id, revokedAt: { $exists: false } })) >= 20) return apiError(409, "CONFLICT", "TOO_MANY_TOKENS", "Revoke an old token first.");
  const token = `ss_${randomBytes(33).toString("base64url")}`;
  const row = await ApiToken.create({ ownerId: auth.user!._id, name: parsed.data.name, tokenHash: hashToken(token), prefix: token.slice(0, 10), expiresAt: new Date(Date.now() + parsed.data.days * 86_400_000) });
  // The token is shown once. Only its HMAC is stored.
  return json({ id: String(row._id), name: row.name, token, expiresAt: row.expiresAt }, 201);
}
