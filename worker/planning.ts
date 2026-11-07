import { ProviderError } from "../src/server/providers/errors";
import { brainstormAngles, planDraft, postReply, researchBrief, reviseDraft, type PlanningJob } from "../src/server/planning";
import { QuotaError } from "../src/server/usage";
import { claimOne, settleBadge, Stop, type Failure } from "./lease";

const TYPES = ["brainstorm", "plan", "revise", "scene_regen", "brief_refine"];

function failure(error: unknown): Failure {
  if (error instanceof QuotaError) return { code: "QUOTA_EXHAUSTED", message: error.message, retryable: false };
  if (error instanceof ProviderError) {
    if (error.kind === "auth") return { code: "PLANNER_UNAVAILABLE", message: "The planner key is not working. Check it, then try again.", retryable: true };
    if (error.kind === "rate_limited") return { code: "RATE_LIMITED", message: "The planner asked us to slow down. Try again in a minute.", retryable: true };
    if (error.kind === "quota") return { code: "QUOTA_EXHAUSTED", message: "The planner's allowance is used up.", retryable: false };
    return { code: "PLANNER_UNAVAILABLE", message: "The planner is unavailable right now. Try again shortly.", retryable: true };
  }
  if (error instanceof Error && error.message !== "STOP" && error.message.length < 240) return { code: "PLAN_FAILED", message: error.message, retryable: true };
  return { code: "PLAN_FAILED", message: "That did not work. Try again.", retryable: true };
}

/** Claims one planning job (brainstorm, plan, copilot revise) and runs it under a lease. */
export function processPlanning(): Promise<boolean> {
  return claimOne({
    match: { type: { $in: TYPES } },
    leaseMs: 45_000,
    exhausted: { code: "WORKER_EXHAUSTED", message: "Planning did not finish after three tries. Try again.", retryable: true },
    failure,
    onFailed: async (job) => {
      await settleBadge(job);
      if (job.type === "revise" || job.type === "scene_regen") {
        const reason = await import("../src/server/db").then(({ Job }) => Job.findById(job._id).select("error").lean<{ error?: { message?: string } }>());
        await postReply(job as unknown as PlanningJob, reason?.error?.message || "I could not make that change.");
      }
    },
    run: async (lease) => {
      const job = lease.job as unknown as PlanningJob;
      await lease.stage([{ name: job.type, state: "running" }]);
      let result: Record<string, unknown>;
      if (job.type === "brainstorm") result = await brainstormAngles(job);
      else if (job.type === "plan") result = await planDraft(job, lease.signal);
      else if (job.type === "brief_refine") result = await researchBrief(job);
      else result = await reviseDraft(job);
      if (lease.signal.aborted) throw new Stop();
      await lease.succeed({ ...result }, undefined);
      if (job.type === "revise" || job.type === "scene_regen") {
        const candidate = result.candidate as { summary?: string } | undefined;
        await postReply(job, candidate?.summary || "No change was needed.", candidate);
      }
    },
  });
}
