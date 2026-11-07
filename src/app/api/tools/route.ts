import { z } from "zod";
import { authed, busy, json } from "../../../server/guard";
import { apiError } from "../../../server/http";
import { enqueue } from "../../../server/jobs";
import { limit } from "../../../server/rate-limit";
import { bannerSchema, copySchema } from "../../../server/tools";

/** Banner (PNG with safe areas) or profile copy (headline, About, bios). Runs in the worker. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.discriminatedUnion("tool", [
    z.object({ tool: z.literal("banner"), input: bannerSchema }).strict(),
    z.object({ tool: z.literal("profile-copy"), input: copySchema }).strict(),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", `Check the fields: ${parsed.error.issues[0]?.path.join(".") || "body"} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  if (!(await limit(request, "tools", 30, 60 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of drafts this hour. Try again later.");
  try {
    // Tools use the creator's own slot, so two drafts at once queue one after another.
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: auth.user!._id, type: "tool", input: parsed.data, stages: [parsed.data.tool] });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start that.");
  }
}
