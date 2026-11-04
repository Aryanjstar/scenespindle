import mongoose from "mongoose";
import { Project } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { RETENTION_MS } from "../../../../../server/cleanup";

/** Undo a delete within seven days. Share links stay revoked; make new ones if needed. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const project = await Project.findOneAndUpdate(
    { _id: id, ownerId: auth.user!._id, deletedAt: { $gt: new Date(Date.now() - RETENTION_MS) } },
    { $unset: { deletedAt: 1 }, $set: { badge: "draft" } },
    { new: true, withDeleted: true },
  );
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  return json({ project: { id: String(project._id), title: project.title } });
}
