import { z } from "zod";
import { idempotent } from "../../../../../server/idempotency";
import { Asset, Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { enqueue } from "../../../../../server/jobs";
import { limit } from "../../../../../server/rate-limit";
import { ownProject } from "../../../../../server/studio";
import { loadEnv } from "../../../../../config/env";
import { sttAvailable } from "../../../../../server/providers/stt";

const bodySchema = z.object({
  assetId: z.string().regex(/^[a-f0-9]{24}$/),
  source: z.enum(["auto", "text"]),
  text: z.string().trim().max(20000).default(""),
  style: z.enum(["phrase", "punchy", "karaoke"]).default("phrase"),
  band: z.enum(["auto", "upper", "middle", "lower", "above-head"]).default("auto"),
  language: z.enum(["auto", "en", "hi"]).default("auto"),
}).strict();

/** Caption the creator's own reel. Runs in the worker; the result is a versioned, shareable video. */
async function handle(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "reel") return apiError(422, "VALIDATION", "WRONG_MODE", "Reels are captioned in a Caption a reel project.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose a reel, how to time the captions, and where they go.");
  const body = parsed.data;
  if (body.source === "text" && !body.text) return apiError(400, "VALIDATION", "VALIDATION", "Paste your captions: SRT, LRC or plain lines.");
  if (body.style === "karaoke") {
    const canListen = sttAvailable(loadEnv()).available;
    if (/[\u0900-\u097F]/.test(body.text)) return apiError(422, "VALIDATION", "LYRICS_SCRIPT", "Write the lyrics in English letters (romanized), not Devanagari.");
    if (!body.text.trim() && !canListen) return apiError(400, "VALIDATION", "LYRICS_MISSING", "Paste the words you sing, one line per row. Times are optional.");
  }
  if (body.source === "auto" && body.style !== "karaoke" && !sttAvailable(loadEnv()).available) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", sttAvailable(loadEnv()).reason ?? "Automatic timing is not configured.");
  if (!(await Asset.exists({ _id: body.assetId, ownerId: auth.user!._id, kind: "video" }))) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That reel is not in your library.");
  if (!(await limit(request, "render", 10, 60 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "That is a lot of renders this hour. Try again later.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "caption", input: { ...body, format: project.format }, stages: ["listen", "place", "burn", "qa"] });
    await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { badge: "rendering", montage: { reel: body } } });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start captioning.");
  }
}

/** Accepts an Idempotency-Key header; a repeat returns the first response. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const text = await request.text();
  const replay = () => handle(new Request(request.url, { method: "POST", headers: request.headers, body: text }), ctx);
  return idempotent(request, auth.user!._id, `captions:${(await ctx.params).id}`, text, replay);
}
