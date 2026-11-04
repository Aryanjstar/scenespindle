import mongoose from "mongoose";
import { z } from "zod";
import { connectDb, Invite, User } from "../../../../server/db";
import { apiError, originOk } from "../../../../server/http";
import { hashPassword, hashToken, openSession, passwordOk } from "../../../../server/session";
import { json } from "../../../../server/guard";
import { limit } from "../../../../server/rate-limit";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().trim().min(1).max(120), password: z.string().min(10).max(128) }).strict();
class InvalidInvite extends Error {}
export async function POST(request: Request) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordOk(parsed.data.password)) return apiError(400, "VALIDATION", "INVALID_JOIN", "Check your name and choose a password of at least 10 characters.");
  try { await connectDb(); } catch { return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable."); }
  if (!(await limit(request, "join", 5, 3_600_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many attempts. Try again in an hour.");
  const tokenHash = hashToken(parsed.data.token);
  const eligible = { tokenHash, usedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } };
  if (!await Invite.exists(eligible)) return apiError(400, "VALIDATION", "INVALID_INVITE", "This invitation is invalid, expired or already used.");
  const passwordHash = await hashPassword(parsed.data.password);
  const session = await mongoose.startSession();
  try {
    let userId: mongoose.Types.ObjectId | undefined;
    await session.withTransaction(async () => {
      const invite = await Invite.findOneAndUpdate({ ...eligible, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { session, new: true });
      if (!invite || await User.exists({ email: invite.email }).session(session)) throw new InvalidInvite();
      const [user] = await User.create([{ email: invite.email, name: parsed.data.name, passwordHash, passwordChangedAt: new Date() }], { session });
      userId = user._id;
    });
    await openSession(userId, request.headers.get("user-agent"));
    return json({ joined: true }, 201);
  } catch (error) {
    if (error instanceof InvalidInvite || (error && typeof error === "object" && "code" in error && error.code === 11000)) return apiError(400, "VALIDATION", "INVALID_INVITE", "This invitation is invalid, expired or already used.");
    throw error;
  } finally { await session.endSession(); }
}
