import mongoose from "mongoose";
import { Character } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, busy, json } from "../../../../../server/guard";
import { enqueue } from "../../../../../server/jobs";
import { imageConfig } from "../../../../../server/providers/images";

/** Draw a new version of the character sheet. Earlier versions stay attached to the films that used them. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  if (!imageConfig()) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", "Image generation is not configured.");
  const item = await Character.findOneAndUpdate({ _id: id, ownerId: auth.user!._id }, { $set: { state: "drawing" } });
  if (!item) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: item._id, type: "image", input: { kind: "character", characterId: String(item._id) }, stages: ["sheet"] });
    return json({ jobId }, 202);
  } catch (error) {
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start drawing.");
  }
}
