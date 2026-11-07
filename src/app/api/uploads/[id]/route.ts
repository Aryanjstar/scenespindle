import mongoose from "mongoose";
import { Upload } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";
import { putBuffer } from "../../../../server/storage";
import { PART_BYTES } from "../route";

/** Send one part: PUT /api/uploads/{id}?part=N with the raw bytes. Re-sending a part replaces it. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const part = Number(new URL(request.url).searchParams.get("part"));
  if (!mongoose.isValidObjectId(id) || !Number.isInteger(part) || part < 0) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  const upload = await Upload.findOne({ _id: id, ownerId: auth.user!._id, assetId: { $exists: false } });
  if (!upload || part >= upload.parts) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  const bytes = Buffer.from(await request.arrayBuffer());
  const expected = part === upload.parts - 1 ? upload.size - PART_BYTES * part : PART_BYTES;
  if (bytes.length !== expected) return apiError(400, "VALIDATION", "PART_SIZE", `Part ${part} should be ${expected} bytes.`);
  await putBuffer(`upload-parts/${String(upload._id)}/${part}`, bytes);
  const updated = await Upload.findOneAndUpdate({ _id: upload._id }, { $addToSet: { received: part } }, { new: true });
  return json({ received: updated!.received.length, parts: upload.parts });
}

/** Which parts arrived, so an interrupted upload resumes where it stopped. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  const upload = await Upload.findOne({ _id: id, ownerId: auth.user!._id });
  if (!upload) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  return json({ id, parts: upload.parts, received: [...upload.received].sort((a, b) => a - b), assetId: upload.assetId ? String(upload.assetId) : null });
}
