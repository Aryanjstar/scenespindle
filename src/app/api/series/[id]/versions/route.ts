import mongoose from "mongoose";
import { z } from "zod";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { snapshotSeries } from "../../../../../server/series";

/** Approve the current bible and cast as an immutable series version. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That series is not here.");
  const parsed = z.object({ expectedRevision: z.number().int().positive() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send the revision you are approving.");
  try {
    const version = await snapshotSeries(auth.user!._id, id, parsed.data.expectedRevision);
    return json({ version }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "REVISION_CONFLICT") return apiError(409, "CONFLICT", "REVISION_CONFLICT", "This series changed or is not here. Reload it.");
    throw error;
  }
}
