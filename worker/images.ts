import { randomUUID } from "node:crypto";
import { Character, Job, Project } from "../src/server/db";
import { ProviderError } from "../src/server/providers/errors";
import { drawCharacter, drawStills } from "../src/server/stills";
import { QuotaError } from "../src/server/usage";

const leaseMs = 120_000;

function failure(error: unknown) {
  if (error instanceof QuotaError) return { code: "QUOTA_EXHAUSTED", message: "The monthly image allowance is used up.", retryable: false };
  if (error instanceof ProviderError && error.kind === "auth") return { code: "IMAGES_UNAVAILABLE", message: "Image generation is not configured.", retryable: false };
  if (error instanceof ProviderError && error.kind === "policy") return { code: "IMAGE_REFUSED", message: "The image service refused a picture. Edit its description and try again.", retryable: false };
  if (error instanceof ProviderError && error.kind === "invalid") return { code: "IMAGE_REFUSED", message: "The image service could not draw that. Edit the description or reference image.", retryable: false };
  if (error instanceof Error && /^(Plan a valid|The storyboard|That character)/.test(error.message)) return { code: "INPUT_INVALID", message: error.message, retryable: true };
  return { code: "IMAGES_FAILED", message: "The pictures could not be drawn. Try again.", retryable: true };
}

/** Claims one image job: a character sheet or a story's stills. */
export async function processImages(): Promise<boolean> {
  const now = new Date();
  const token = randomUUID();
  const job = await Job.findOneAndUpdate({
    type: "image", attempts: { $lt: 3 },
    $or: [{ state: "queued", runAfter: { $lte: now } }, { state: "running", leaseExpiresAt: { $lte: now } }],
  }, { $set: { state: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs) }, $inc: { attempts: 1 } }, { sort: { runAfter: 1, _id: 1 }, new: true });
  if (!job) return false;
  const held = () => ({ _id: job._id, state: "running", leaseToken: token, leaseExpiresAt: { $gt: new Date() } });
  const timer = setInterval(() => { void Job.updateOne(held(), { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }).catch(() => {}); }, 20_000);
  timer.unref();
  try {
    let result: Record<string, unknown>;
    if (job.input.kind === "character") {
      result = await drawCharacter(job.ownerId, job.input.characterId);
    } else {
      result = await drawStills(job.ownerId, job.projectId, {
        sceneIds: job.input.sceneIds ?? [],
        redraw: Boolean(job.input.redraw),
        onProgress: async (done, total) => { await Job.updateOne(held(), { $set: { progress: Math.round((done / total) * 100), stages: [{ name: "stills", state: "running", done, total }] } }); },
      });
      await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId, badge: "planning" }, { $set: { badge: "review" } });
    }
    await Job.updateOne(held(), { $set: { state: "succeeded", finishedAt: new Date(), progress: 100, result, stages: [{ name: job.input.kind === "character" ? "sheet" : "stills", state: "done" }] }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } });
  } catch (error) {
    const reason = failure(error);
    console.error("images-failed", String(job._id), reason.code, error instanceof Error ? error.message.slice(0, 300) : "");
    await Job.updateOne(held(), { $set: { state: "failed", finishedAt: new Date(), error: reason }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } });
    if (job.input.kind === "character") await Character.updateOne({ _id: job.input.characterId, ownerId: job.ownerId }, { $set: { state: "failed" } });
  } finally {
    clearInterval(timer);
  }
  return true;
}
