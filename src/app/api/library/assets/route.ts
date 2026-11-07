import { putBuffer } from "../../../../server/storage";
import { Asset } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";

export async function GET(request: Request) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const kind = new URL(request.url).searchParams.get("kind");
  const filter: Record<string, unknown> = { ownerId: auth.user!._id, deletedAt: { $exists: false } };
  if (kind && ["image", "audio", "video", "mask"].includes(kind)) filter.kind = kind;
  const mine = await Asset.find(filter).sort({ createdAt: -1 }).limit(100);
  return json({
    items: mine.map((item) => ({ id: String(item._id), name: item.name, kind: item.kind, licence: item.licence, source: item.source, bytes: item.bytes ?? null, rights: item.provenance?.rights ?? (item.source === "generated" ? "original-generated" : "creator-claimed"), createdAt: item.createdAt, mine: true })),
  });
}

export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const form = await request.formData().catch(() => null);
  if (!form) return apiError(400, "VALIDATION", "VALIDATION", "Choose a file.");
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "VALIDATION", "VALIDATION", "Choose a file.");
  if (file.size > 100_000_000) return apiError(413, "VALIDATION", "PAYLOAD_TOO_LARGE", "Files stay under 100 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the declared type.
  const sniffed = sniff(bytes);
  if (!sniffed) return apiError(415, "VALIDATION", "UNSUPPORTED_TYPE", "Use a PNG, JPEG, WebP, MP3, WAV or MP4 file.");
  const key = `uploads/${String(auth.user!._id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${sniffed.ext}`;
  const stored = await putBuffer(key, bytes);
  const rights = form.get("rights");
  const asMask = form.get("kind") === "mask" && sniffed.mime === "image/png";
  const asset = await Asset.create({
    ownerId: auth.user!._id,
    kind: asMask ? "mask" : sniffed.kind,
    name: file.name.slice(0, 120).replaceAll(/[\u0000-\u001f]/g, ""),
    path: key,
    mime: sniffed.mime,
    bytes: stored.bytes,
    sha256: stored.sha256,
    // Uploading is a claim of rights, not proof; the claim is recorded as stated.
    licence: "creator-claimed",
    source: "mine",
    provenance: { rights: rights === "licensed" || rights === "unknown" ? rights : "own", uploadedAt: new Date() },
  });
  return json({ asset: { id: String(asset._id), name: asset.name, kind: asset.kind, licence: asset.licence, bytes: stored.bytes } }, 201);
}

export function sniff(bytes: Buffer): { kind: "image" | "audio" | "video"; mime: string; ext: string } | null {
  const hex = bytes.subarray(0, 12).toString("hex");
  const ascii = bytes.subarray(0, 12).toString("latin1");
  if (hex.startsWith("89504e470d0a1a0a")) return { kind: "image", mime: "image/png", ext: "png" };
  if (hex.startsWith("ffd8ff")) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { kind: "audio", mime: "audio/wav", ext: "wav" };
  if (ascii.startsWith("ID3") || hex.startsWith("fffb") || hex.startsWith("fff3") || hex.startsWith("fff2")) return { kind: "audio", mime: "audio/mpeg", ext: "mp3" };
  if (ascii.slice(4, 8) === "ftyp") return { kind: "video", mime: "video/mp4", ext: "mp4" };
  return null;
}
