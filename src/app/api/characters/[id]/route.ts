import mongoose from "mongoose";
import { z } from "zod";
import { Asset, Character, CharacterVersion } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";
import { characterJson, stageLookSchema } from "../../../../server/characters";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  const item = await Character.findOne({ _id: id, ownerId: auth.user!._id });
  if (!item) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  const versions = await CharacterVersion.find({ characterId: item._id, ownerId: auth.user!._id }).sort({ version: -1 });
  return json({ character: { ...characterJson(item), versions: versions.map((v) => ({ version: v.version, sheetUrl: `/api/assets/${String(v.sheetAssetId)}/file`, style: v.style, createdAt: v.createdAt })) } });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  const parsed = z.object({
    description: z.string().trim().max(280).optional(),
    style: z.enum(["flat", "cartoon", "storybook", "clay"]).optional(),
    look: stageLookSchema.optional(),
    rights: z.enum(["own", "licensed", "original-generated"]).optional(),
    rightsNote: z.string().trim().max(280).optional(),
    referenceAssetId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.message ?? "Check the character fields.");
  if (parsed.data.referenceAssetId && !(await Asset.exists({ _id: parsed.data.referenceAssetId, ownerId: auth.user!._id, kind: "image" }))) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That reference image is not in your library.");
  // Changing the look takes effect when the character is drawn again; old films keep their version.
  const item = await Character.findOneAndUpdate({ _id: id, ownerId: auth.user!._id }, { $set: parsed.data }, { new: true });
  if (!item) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  return json({ character: characterJson(item) });
}

/** Remove a character. Films and approved series versions keep the versions they used. */
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  const result = await Character.deleteOne({ _id: id, ownerId: auth.user!._id });
  if (!result.deletedCount) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  return json({ deleted: true });
}
