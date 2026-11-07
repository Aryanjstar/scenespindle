import { createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { Asset, Upload } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { fetchToFile, putFile, removePrefix } from "../../../../../server/storage";
import { sniff } from "../../../library/assets/route";

/** Join the parts, check what the bytes really are, and add the file to the library. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  const upload = await Upload.findOne({ _id: id, ownerId: auth.user!._id });
  if (!upload) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That upload is not here.");
  if (upload.assetId) return json({ asset: { id: String(upload.assetId) } });
  if (new Set(upload.received).size !== upload.parts) return apiError(409, "CONFLICT", "PARTS_MISSING", "Some parts have not arrived yet.", { received: upload.received.length, parts: upload.parts });
  const dir = mkdtempSync(join(tmpdir(), "ss-up-"));
  try {
    const joined = join(dir, "joined");
    const out = createWriteStream(joined);
    for (let part = 0; part < upload.parts; part++) {
      const file = await fetchToFile(`upload-parts/${String(upload._id)}/${part}`, join(dir, `p${part}`));
      out.write(readFileSync(file));
      rmSync(file);
    }
    await new Promise<void>((resolve, reject) => { out.end(() => resolve()); out.on("error", reject); });
    const head = Buffer.alloc(12);
    const fd = readFileSync(joined).subarray(0, 12);
    fd.copy(head);
    const sniffed = sniff(head);
    if (!sniffed) return apiError(415, "VALIDATION", "UNSUPPORTED_TYPE", "Use a PNG, JPEG, WebP, MP3, WAV or MP4 file.");
    const key = `uploads/${String(auth.user!._id)}/${Date.now()}-${String(upload._id).slice(-6)}.${sniffed.ext}`;
    const stored = await putFile(key, joined);
    const asMask = upload.kind === "mask" && sniffed.mime === "image/png";
    const asset = await Asset.create({ ownerId: auth.user!._id, kind: asMask ? "mask" : sniffed.kind, name: upload.name, path: key, mime: sniffed.mime, bytes: stored.bytes, sha256: stored.sha256, licence: "creator-claimed", source: "mine", provenance: { rights: upload.rights, uploadedAt: new Date() } });
    await Upload.updateOne({ _id: upload._id }, { $set: { assetId: asset._id } });
    await removePrefix(`upload-parts/${String(upload._id)}/`).catch(() => {});
    return json({ asset: { id: String(asset._id), name: asset.name, kind: asset.kind, bytes: stored.bytes } }, 201);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
