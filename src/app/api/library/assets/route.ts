import { putBuffer } from "../../../../server/storage";
import { Asset } from "../../../../server/db";
import { apiError } from "../../../../server/http";
import { authed, json } from "../../../../server/guard";

const SYSTEM = [
  { id: "moon", name: "Why it stays up", kind: "video", licence: "produced-in-studio", source: "system" },
  { id: "code", name: "Find 21", kind: "video", licence: "produced-in-studio", source: "system" },
  { id: "story", name: "Ek lattu", kind: "video", licence: "produced-in-studio", source: "system" },
];

export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const mine = await Asset.find({ ownerId: auth.user!._id }).sort({ createdAt: -1 }).limit(40);
  return json({
    items: [
      ...SYSTEM,
      ...mine.map((item) => ({ id: String(item._id), name: item.name, kind: item.kind, licence: item.licence, source: item.source, mine: true })),
    ],
  });
}

export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "VALIDATION", "VALIDATION", "Choose a file.");
  if (file.size > 25_000_000) return apiError(413, "VALIDATION", "PAYLOAD_TOO_LARGE", "Files stay under 25 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the declared type.
  const sniffed = sniff(bytes);
  if (!sniffed) return apiError(415, "VALIDATION", "UNSUPPORTED_TYPE", "Use a PNG, JPEG, WebP, MP3, WAV or MP4 file.");
  const key = `uploads/${String(auth.user!._id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${sniffed.ext}`;
  await putBuffer(key, bytes);
  const path = key;
  const asset = await Asset.create({
    ownerId: auth.user!._id,
    kind: sniffed.kind,
    name: file.name.slice(0, 120),
    path: key,
    mime: sniffed.mime,
    licence: "creator-claimed",
    source: "mine",
  });
  return json({ asset: { id: String(asset._id), name: asset.name, kind: asset.kind, licence: asset.licence } }, 201);
}

function sniff(bytes: Buffer): { kind: "image" | "audio" | "video"; mime: string; ext: string } | null {
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
