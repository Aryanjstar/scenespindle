import { z } from "zod";
import { Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { enqueue } from "../../../../../server/jobs";
import { imageConfig } from "../../../../../server/providers/images";
import { ownProject } from "../../../../../server/studio";

/** Draw (or redraw) the stills of a Story or Cartoon storyboard before approval. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "story" && project.mode !== "cartoon") return apiError(422, "VALIDATION", "WRONG_MODE", "Stills are drawn for Story and Cartoon projects.");
  if (!imageConfig()) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", "Image generation is not configured.");
  const parsed = z.object({ sceneIds: z.array(z.string().regex(/^s\d{1,2}$/)).max(15).default([]), redraw: z.boolean().default(false) }).strict().safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send scene ids like s2 and an optional redraw flag.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: project._id, type: "image", input: { kind: "stills", ...parsed.data }, stages: ["stills"] });
    await Project.updateOne({ _id: project._id, ownerId: auth.user!._id }, { $set: { badge: "planning" } });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start drawing.");
  }
}
