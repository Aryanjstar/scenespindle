import { z } from "zod";
import { Session, User } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";
import { limit } from "../../../../server/rate-limit";
import { checkPassword, hashPassword, openSession, passwordOk } from "../../../../server/session";

/** Change your password. Every other session is signed out; this one gets a fresh session. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  if (!(await limit(request, "password", 5, 60 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many attempts. Try again in an hour.");
  const parsed = z.object({ current: z.string().min(1).max(200), next: z.string().min(12).max(200) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Enter your current password and a new one of at least 12 characters.");
  if (!passwordOk(parsed.data.next)) return apiError(400, "VALIDATION", "WEAK_PASSWORD", "Choose a less common password.");
  const user = await User.findById(auth.user!._id);
  if (!user || !(await checkPassword(parsed.data.current, user.passwordHash))) return apiError(400, "VALIDATION", "WRONG_PASSWORD", "Your current password is not right.");
  user.passwordHash = await hashPassword(parsed.data.next);
  user.passwordChangedAt = new Date();
  await user.save();
  await Session.deleteMany({ userId: user._id });
  await openSession(user._id, request.headers.get("user-agent"));
  return json({ changed: true });
}
