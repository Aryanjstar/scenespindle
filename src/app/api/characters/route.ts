import { z } from "zod";
import { Asset, Character, CharacterVersion } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, busy, json } from "../../../server/guard";
import { enqueue } from "../../../server/jobs";
import { imageConfig } from "../../../server/providers/images";
import { characterAllowed } from "../../../server/studio";
import { characterJson } from "../../../server/characters";

const createSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(280).default(""),
  style: z.enum(["flat", "cartoon", "storybook", "clay"]).default("storybook"),
  referenceAssetId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  rights: z.enum(["own", "licensed", "original-generated"]).default("own"),
  rightsNote: z.string().trim().max(280).default(""),
  draw: z.boolean().default(true),
}).strict();

export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const items = await Character.find({ ownerId: auth.user!._id }).sort({ updatedAt: -1 }).limit(60);
  const versions = await CharacterVersion.find({ ownerId: auth.user!._id, characterId: { $in: items.map((item) => item._id) } }).sort({ version: -1 }).select("characterId version sheetAssetId createdAt");
  return json({ items: items.map((item) => ({ ...characterJson(item), versions: versions.filter((v) => String(v.characterId) === String(item._id)).map((v) => ({ version: v.version, sheetUrl: `/api/assets/${String(v.sheetAssetId)}/file`, createdAt: v.createdAt })) })), imagesAvailable: Boolean(imageConfig()) });
}

/** Create an original character, optionally from your own reference image, and draw its sheet. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", parsed.error.issues[0]?.message ?? "Check the character fields.");
  const body = parsed.data;
  if (characterAllowed(body.name)) return apiError(422, "VALIDATION", "PROTECTED_CHARACTER", "That character is not allowed. Use an original character.");
  if (await Character.exists({ ownerId: auth.user!._id, name: body.name })) return apiError(409, "CONFLICT", "CHARACTER_NAME_TAKEN", "You already have a character with that name.");
  if (body.referenceAssetId && !(await Asset.exists({ _id: body.referenceAssetId, ownerId: auth.user!._id, kind: "image" }))) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That reference image is not in your library.");
  const character = await Character.create({ ownerId: auth.user!._id, name: body.name, description: body.description, style: body.style, referenceAssetId: body.referenceAssetId, rights: body.rights, rightsNote: body.rightsNote, state: body.draw && imageConfig() ? "drawing" : "draft" });
  let jobId: string | undefined;
  if (body.draw && imageConfig()) {
    try {
      jobId = await enqueue({ ownerId: auth.user!._id, scopeId: character._id, type: "image", input: { kind: "character", characterId: String(character._id) }, stages: ["sheet"] });
    } catch (error) {
      return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start drawing.");
    }
  }
  return json({ character: characterJson(character), jobId }, 201);
}
