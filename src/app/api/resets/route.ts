import { z } from "zod";
import { User } from "../../../server/db";
import { authed, json } from "../../../server/guard";
import { apiError } from "../../../server/http";
import { createReset } from "../../../server/resets";
import { appEnv } from "../../../config/app";

/** Owner-only: make a one-hour reset link for a creator when email is not configured. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const owner = appEnv().ownerEmail;
  if (!owner || auth.user!.email !== owner) return apiError(403, "FORBIDDEN", "OWNER_ONLY", "Only the studio owner can make reset links.");
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_EMAIL", "Enter a valid email address.");
  const user = await User.findOne({ email: parsed.data.email });
  if (!user) return apiError(404, "NOT_FOUND", "NOT_FOUND", "No creator has that email.");
  const reset = await createReset(user._id);
  return json({ email: user.email, url: reset.url, expiresAt: reset.expiresAt, delivery: "copy_link" }, 201);
}
