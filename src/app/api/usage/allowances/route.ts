import { z } from "zod";
import mongoose from "mongoose";
import { User } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, isOwner, json } from "../../../../server/guard";
import { creatorUsage } from "../../../../server/usage";

const PROVIDERS = ["gemini", "elevenlabs", "sarvam", "images", "stt"] as const;

/** Owner only: every creator with their caps and this month's use. */
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  if (!isOwner(auth.user)) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can see allowances.");
  const users = await User.find({}).select("email name allowances").sort({ createdAt: 1 }).limit(200).lean<{ _id: unknown; email: string; name: string; allowances?: Record<string, number> }[]>();
  const items = await Promise.all(users.map(async (user) => {
    const used = await creatorUsage(user._id);
    return { id: String(user._id), email: user.email, name: user.name, allowances: user.allowances ?? {}, used: Object.fromEntries(used.map((row) => [row.provider, row.used + row.reserved])) };
  }));
  return json({ items, providers: PROVIDERS });
}

/** Owner only: set (or clear with null) one creator's monthly cap for a provider. */
export async function PATCH(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  if (!isOwner(auth.user)) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can change allowances.");
  const parsed = z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/), provider: z.enum(PROVIDERS), limit: z.number().int().min(0).max(100_000_000).nullable() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose a creator, a provider and a whole-number limit.");
  const { userId, provider, limit } = parsed.data;
  const update = limit === null ? { $unset: { [`allowances.${provider}`]: 1 } } : { $set: { [`allowances.${provider}`]: limit } };
  const user = await User.findOneAndUpdate({ _id: new mongoose.Types.ObjectId(userId) }, update, { new: true }).select("allowances");
  if (!user) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That creator is not here.");
  return json({ id: userId, allowances: user.allowances ?? {} });
}
