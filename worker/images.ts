import { Character, Project } from "../src/server/db";
import { ProviderError } from "../src/server/providers/errors";
import { drawCharacter, drawStills } from "../src/server/stills";
import { QuotaError } from "../src/server/usage";
import { claimOne, settleBadge, Stop, type Failure } from "./lease";

function failure(error: unknown): Failure {
  if (error instanceof QuotaError) return { code: "QUOTA_EXHAUSTED", message: error.message, retryable: false };
  if (error instanceof ProviderError && error.kind === "auth") return { code: "IMAGES_UNAVAILABLE", message: "Image generation is not configured.", retryable: false };
  if (error instanceof ProviderError && error.kind === "policy") return { code: "IMAGE_REFUSED", message: "The image service refused a picture. Edit its description and try again.", retryable: false };
  if (error instanceof ProviderError && error.kind === "invalid") return { code: "IMAGE_REFUSED", message: "The image service could not draw that. Edit the description or reference image.", retryable: false };
  if (error instanceof Error && /^(Plan a valid|The storyboard|That character)/.test(error.message)) return { code: "INPUT_INVALID", message: error.message, retryable: true };
  return { code: "IMAGES_FAILED", message: "The pictures could not be drawn. Try again.", retryable: true };
}

/** Claims one image job: a character sheet or a story's stills. */
export function processImages(): Promise<boolean> {
  return claimOne({
    match: { type: "image" },
    leaseMs: 120_000,
    exhausted: { code: "WORKER_EXHAUSTED", message: "The pictures could not be drawn after three tries.", retryable: true },
    failure,
    onFailed: async (job) => {
      if (job.input?.kind === "character") await Character.updateOne({ _id: job.input.characterId, ownerId: job.ownerId, state: "drawing" }, { $set: { state: "failed" } });
      else await settleBadge(job);
    },
    run: async (lease) => {
      const { job } = lease;
      let result: Record<string, unknown>;
      if (job.input.kind === "character") {
        await lease.stage([{ name: "sheet", state: "running" }], 0);
        result = await drawCharacter(job.ownerId, job.input.characterId, lease.signal);
      } else {
        result = await drawStills(job.ownerId, job.projectId, {
          sceneIds: job.input.sceneIds ?? [],
          redraw: Boolean(job.input.redraw),
          signal: lease.signal,
          onProgress: (done, total) => lease.stage([{ name: "stills", state: "running", done, total } as never], Math.round((done / total) * 100)),
        });
        await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId, badge: "planning" }, { $set: { badge: "review" } });
      }
      if (lease.signal.aborted) throw new Stop();
      await lease.succeed(result);
    },
  });
}
