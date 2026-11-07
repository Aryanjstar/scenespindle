import { z } from "zod";
import { User } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, isOwner, json } from "../../../server/guard";

const prefsSchema = z.object({
  defaultMode: z.enum(["explainer", "code_lab", "story", "audio", "cartoon", "montage", "lyrics", "reel"]),
  defaultFormat: z.enum(["9x16", "16x9", "1x1"]),
  defaultTargetMs: z.number().int().min(15000).max(180000),
  defaultLanguage: z.enum(["en", "hi", "hinglish"]),
  defaultVoiceId: z.string().min(3).max(80),
  reducedMotion: z.boolean(),
}).partial().strict();

function account(user: { _id: unknown; email: string; name: string; prefs?: unknown; createdAt?: Date }) {
  return { id: String(user._id), email: user.email, name: user.name, prefs: user.prefs ?? {}, owner: isOwner(user), createdAt: user.createdAt };
}

export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  return json({ account: account(auth.user!) });
}

/** Change your display name and studio defaults. Email changes go through the owner. */
export async function PATCH(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(120).optional(), prefs: prefsSchema.optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.message ?? "Check your account fields.");
  const set: Record<string, unknown> = {};
  if (parsed.data.name) set.name = parsed.data.name;
  for (const [key, value] of Object.entries(parsed.data.prefs ?? {})) set[`prefs.${key}`] = value;
  const user = await User.findOneAndUpdate({ _id: auth.user!._id }, { $set: set }, { new: true });
  return json({ account: account(user!) });
}
