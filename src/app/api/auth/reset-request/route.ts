import { z } from "zod";
import { connectDb, User } from "../../../../server/db";
import { apiError, originOk } from "../../../../server/http";
import { json } from "../../../../server/guard";
import { mailConfigured, sendMail } from "../../../../server/mail";
import { limit } from "../../../../server/rate-limit";
import { createReset } from "../../../../server/resets";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

export async function POST(request: Request) {
  if (!originOk(request)) return apiError(403, "FORBIDDEN", "ORIGIN", "This request came from the wrong site.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_EMAIL", "Enter a valid email address.");
  try { await connectDb(); } catch { return apiError(503, "UNAVAILABLE", "DB_DOWN", "The studio database is not reachable."); }
  if (!(await limit(request, "reset-request", 5, 3_600_000))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many reset requests. Try again in an hour.");
  const user = await User.findOne({ email: parsed.data.email });
  if (user && mailConfigured()) {
    const reset = await createReset(user._id);
    await sendMail(user.email, "Reset your SceneSpindle password", `Use this link within one hour to choose a new password:\n\n${reset.url}\n\nIf you did not ask for this, ignore this email.`);
  }
  // Same answer whether or not the account exists.
  return json({
    accepted: true,
    delivery: mailConfigured() ? "email" : "owner",
    message: mailConfigured()
      ? "If that account exists, a reset link is on its way."
      : "Email is not set up for this studio. Ask the studio owner for a reset link.",
  }, 202);
}
