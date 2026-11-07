import { z } from "zod";
import { ACCESSORIES, BUILDS, HAIR_STYLES, OUTFITS, cleanLook } from "../compiler/stage";

/** How a character looks on the 3D stage. Colours are #rrggbb; the rest are registered values. */
export const stageLookSchema = z.object({
  skin: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  hair: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  hairStyle: z.enum(HAIR_STYLES),
  top: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bottom: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  outfit: z.enum(OUTFITS),
  build: z.enum(BUILDS),
  accessory: z.enum(ACCESSORIES),
}).strict();

export function characterJson(item: { _id: unknown; name: string; description?: string; style: string; version?: number; state?: string; rights?: string; rightsNote?: string; sheetAssetId?: unknown; referenceAssetId?: unknown; look?: unknown; updatedAt?: Date }, index = 0) {
  return {
    id: String(item._id), name: item.name, description: item.description ?? "", style: item.style, version: item.version ?? 0, state: item.state ?? "draft", rights: item.rights ?? "own", rightsNote: item.rightsNote ?? "",
    sheetUrl: item.sheetAssetId ? `/api/assets/${String(item.sheetAssetId)}/file` : null,
    referenceUrl: item.referenceAssetId ? `/api/assets/${String(item.referenceAssetId)}/file` : null,
    referenceAssetId: item.referenceAssetId ? String(item.referenceAssetId) : null,
    look: cleanLook(item.look, index),
    updatedAt: item.updatedAt,
  };
}
