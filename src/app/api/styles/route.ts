import { z } from "zod";
import { Asset, Style } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, busy, json } from "../../../server/guard";
import { enqueue } from "../../../server/jobs";

function styleJson(item: { _id: unknown; name: string; base: string; state: string; spec?: { measured?: unknown; notes?: string; pacing?: string; fonts?: unknown; palette?: unknown; grade?: string }; createdAt?: Date }) {
  return { id: String(item._id), name: item.name, base: item.base, state: item.state, notes: item.spec?.notes ?? "", measured: item.spec?.measured ?? null, pacing: item.spec?.pacing ?? null, fonts: item.spec?.fonts ?? null, palette: item.spec?.palette ?? null, grade: item.spec?.grade ?? null, createdAt: item.createdAt };
}

export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const items = await Style.find({ ownerId: auth.user!._id }).sort({ createdAt: -1 }).limit(50);
  return json({ items: items.map(styleJson) });
}

/** Learn a montage style from reference videos in your library. Runs in the worker. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(80), assetIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(5) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Name the style and choose 1 to 5 reference videos.");
  const count = await Asset.countDocuments({ _id: { $in: parsed.data.assetIds }, ownerId: auth.user!._id, kind: "video" });
  if (count !== new Set(parsed.data.assetIds).size) return apiError(404, "NOT_FOUND", "NOT_FOUND", "Choose reference videos from your library.");
  const style = await Style.create({ ownerId: auth.user!._id, name: parsed.data.name, base: "beat-cut@1", spec: {}, sourceAssetIds: parsed.data.assetIds, state: "analyzing" });
  try {
    const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: style._id, type: "analysis", input: { styleId: String(style._id) }, stages: ["analyze"] });
    return json({ style: styleJson(style), jobId }, 202);
  } catch (error) {
    await Style.deleteOne({ _id: style._id });
    return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start learning that style.");
  }
}
