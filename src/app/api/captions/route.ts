import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { z } from "zod";
import { Asset } from "../../../server/db";
import { apiError } from "../../../server/http";
import { authed, json } from "../../../server/guard";
import { fetchToFile, putBuffer } from "../../../server/storage";
import { burnCaptionReel, parseCaptionText, probeReel } from "../../../pipeline/caption-reel";

const bodySchema = z.object({
  assetId: z.string().regex(/^[a-f0-9]{24}$/),
  text: z.string().trim().min(1).max(20000),
  band: z.enum(["lower", "middle", "upper"]).default("lower"),
}).strict();

/** Caption a reel the creator already uploaded. Times come from SRT or LRC; plain lines are spaced evenly. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BODY", "Choose a reel, a caption band, and the words.");
  const asset = await Asset.findOne({ _id: parsed.data.assetId, ownerId: auth.user!._id, kind: "video" });
  if (!asset) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That reel is not in your library.");
  const dir = mkdtempSync(join(tmpdir(), "ss-cap-"));
  try {
    const source = await fetchToFile(asset.path, join(dir, "in.mp4"));
    const { durationMs } = await probeReel(source);
    if (durationMs > 180_000) return apiError(422, "VALIDATION", "TOO_LONG", "Caption reels stay under 3 minutes.");
    let parsedCues;
    try {
      parsedCues = parseCaptionText(parsed.data.text, durationMs);
    } catch (error) {
      return apiError(422, "VALIDATION", "CAPTIONS_INVALID", error instanceof Error ? error.message : "Those captions could not be read.");
    }
    const out = join(dir, "out.mp4");
    await burnCaptionReel({ video: source, cues: parsedCues.cues, band: parsed.data.band, srtPath: join(dir, "captions.srt"), out });
    const id = new mongoose.Types.ObjectId();
    const key = `videos/${String(auth.user!._id)}/${String(id)}/captioned.mp4`;
    await putBuffer(key, readFileSync(out));
    const saved = await Asset.create({
      _id: id, ownerId: auth.user!._id, kind: "video", name: `${asset.name} captioned`.slice(0, 120), path: key, mime: "video/mp4",
      licence: "creator-claimed", source: "generated", provenance: { kind: "caption-reel", sourceAssetId: String(asset._id), band: parsed.data.band, timing: parsedCues.timing, cues: parsedCues.cues.length },
    });
    return json({ asset: { id: String(saved._id), name: saved.name, url: `/api/assets/${String(saved._id)}/file`, timing: parsedCues.timing, cues: parsedCues.cues.length, band: parsed.data.band } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not caption that reel.";
    return apiError(500, "FAILED", "CAPTION_FAILED", message.includes("ffmpeg") || message.includes("ffprobe") ? "Captioning needs ffmpeg on this machine." : "Could not caption that reel.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
