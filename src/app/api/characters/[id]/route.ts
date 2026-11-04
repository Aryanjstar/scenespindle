import mongoose from "mongoose";
import { z } from "zod";
import { Character, CharacterVersion } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";
import { characterJson } from "../../../../server/characters";

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
  const parsed = z.object({ description: z.string().trim().max(280).optional(), style: z.enum(["flat", "cartoon", "storybook", "clay"]).optional() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send a description or a style.");
  // Changing the look takes effect when the character is drawn again; old films keep their version.
  const item = await Character.findOneAndUpdate({ _id: id, ownerId: auth.user!._id }, { $set: parsed.data }, { new: true });
  if (!item) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That character is not here.");
  return json({ character: characterJson(item) });
}
