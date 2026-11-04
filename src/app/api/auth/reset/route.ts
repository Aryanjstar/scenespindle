import mongoose from "mongoose";
import { z } from "zod";
import { connectDb, Reset, Session, User } from "../../../../server/db";
import { apiError, originOk } from "../../../../server/http";
import { json } from "../../../../server/guard";
import { limit } from "../../../../server/rate-limit";
import { hashPassword, hashToken, openSession, passwordOk } from "../../../../server/session";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(10).max(128) }).strict();
class Invalid extends Error {}

export async function POST(request: Request) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordOk(parsed.data.password)) return apiError(400, "VALIDATION", "INVALID_PASSWORD", "Choose a password of at least 10 characters.");
  try { await connectDb(); } catch { return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable."); }
  if (!(await limit(request, "reset", 5, 3_600_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many attempts. Try again in an hour.");
  const passwordHash = await hashPassword(parsed.data.password);
  const session = await mongoose.startSession();
  let userId: unknown;
  try {
    await session.withTransaction(async () => {
      const reset = await Reset.findOneAndUpdate(
        { tokenHash: hashToken(parsed.data.token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { session, new: true },
      );
      if (!reset) throw new Invalid();
      const user = await User.findOneAndUpdate({ _id: reset.userId }, { $set: { passwordHash, passwordChangedAt: new Date() } }, { session, new: true });
      if (!user) throw new Invalid();
      // A reset signs out every existing session.
      await Session.deleteMany({ userId: user._id }, { session });
      userId = user._id;
    });
  } catch (error) {
    if (error instanceof Invalid) return apiError(400, "VALIDATION", "INVALID_RESET", "This reset link is invalid, expired or already used.");
    throw error;
  } finally {
    await session.endSession();
  }
  await openSession(userId, request.headers.get("user-agent"));
  return json({ reset: true });
}
