import { z } from "zod";
import { Upload } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, json } from "../../../server/guard";

export const PART_BYTES = 8 * 1024 * 1024;

/** Start a resumable upload (up to 500 MB). Send parts with PUT, then complete. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(120), size: z.number().int().min(1).max(500 * 1024 * 1024), rights: z.enum(["own", "licensed", "unknown"]).default("own"), kind: z.enum(["auto", "mask"]).default("auto") }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Send the file name and size (up to 500 MB).");
  const upload = await Upload.create({ ownerId: auth.user!._id, ...parsed.data, parts: Math.ceil(parsed.data.size / PART_BYTES), expiresAt: new Date(Date.now() + 24 * 3600_000) });
  return json({ id: String(upload._id), partBytes: PART_BYTES, parts: upload.parts }, 201);
}
