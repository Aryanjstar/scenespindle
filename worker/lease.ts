import { randomUUID } from "node:crypto";
import type mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import { Job, Project } from "../src/server/db";

/** Thrown when this worker no longer holds the job (lease lost, cancelled, project deleted). */
export class Stop extends Error {
  constructor() { super("STOP"); }
}

/** The fields every lane reads from a claimed job. `input` is the frozen, route-validated payload. */
export type JobDoc = {
  _id: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  type: string;
  target?: string;
  attempts: number;
  input: Record<string, any>;
};

export type Lease = {
  job: JobDoc;
  token: string;
  signal: AbortSignal;
  /** Filter that matches only while this worker still holds the job. */
  held: () => Record<string, unknown>;
  /** Throws Stop if the lease was lost or the job was cancelled. */
  check: () => Promise<void>;
  /** Writes stage progress; throws Stop if the lease is gone. */
  stage: (stages: { name: string; state: string }[], progress?: number) => Promise<void>;
  /** Completes the job while holding the lease. Throws Stop if it was lost. */
  succeed: (result: Record<string, unknown>, session?: ClientSession) => Promise<void>;
};

export type Failure = { code: string; message: string; retryable: boolean };

type Options = {
  /** Extra Mongo filter for the job kinds this lane claims. */
  match: Record<string, unknown>;
  leaseMs: number;
  maxAttempts?: number;
  exhausted: Failure;
  run: (lease: Lease) => Promise<void>;
  failure: (error: unknown) => Failure;
  /** Called after a failure is recorded (for side effects like resetting badges). */
  onFailed?: (job: JobDoc) => Promise<void>;
};

/**
 * Claims one job matching `match`, heartbeats its lease, and records the outcome.
 * Every lane uses this, so a crashed or slow job never holds a project's slot forever:
 * expired leases are reclaimed, and jobs that used all attempts are failed by the sweep.
 */
export async function claimOne(opts: Options): Promise<boolean> {
  const max = opts.maxAttempts ?? 3;
  const now = new Date();
  const token = randomUUID();
  const found = await Job.findOneAndUpdate({
    ...opts.match, attempts: { $lt: max },
    $or: [{ state: "queued", runAfter: { $lte: now } }, { state: "running", leaseExpiresAt: { $lte: now } }],
  }, {
    $set: { state: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + opts.leaseMs), startedAt: now },
    $inc: { attempts: 1 },
  }, { sort: { runAfter: 1, _id: 1 }, new: true });

  if (!found) {
    // Sweep: a job whose last attempt died with the lease still held is failed, freeing the slot.
    const stuck = await Job.find({ ...opts.match, state: "running", attempts: { $gte: max }, leaseExpiresAt: { $lte: now } }).limit(20);
    for (const dead of stuck) {
      const done = await Job.updateOne({ _id: dead._id, state: "running", leaseExpiresAt: { $lte: now } }, {
        $set: { state: "failed", finishedAt: now, error: opts.exhausted },
        $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
      });
      if (done.modifiedCount && opts.onFailed) await opts.onFailed(dead as unknown as JobDoc).catch(() => {});
    }
    return false;
  }

  const job = found as unknown as JobDoc;
  const held = () => ({ _id: job._id, state: "running", leaseToken: token, leaseExpiresAt: { $gt: new Date() } });
  const abort = new AbortController();
  const beat = Math.max(2_000, Math.floor(opts.leaseMs / 3));
  const timer = setInterval(() => {
    void Job.updateOne(held(), { $set: { leaseExpiresAt: new Date(Date.now() + opts.leaseMs) } })
      .then((result) => { if (!result.modifiedCount) abort.abort(); })
      .catch(() => {});
  }, beat);
  timer.unref();

  const lease: Lease = {
    job, token, signal: abort.signal, held,
    check: async () => {
      if (abort.signal.aborted) throw new Stop();
      const still = await Job.exists(held());
      if (!still) { abort.abort(); throw new Stop(); }
    },
    stage: async (stages, progress) => {
      if (abort.signal.aborted) throw new Stop();
      const updated = await Job.updateOne(held(), { $set: { stages, ...(progress === undefined ? {} : { progress }) } });
      if (!updated.modifiedCount) { abort.abort(); throw new Stop(); }
    },
    succeed: async (result, session) => {
      const claim = await Job.updateOne(held(), {
        $set: { state: "succeeded", finishedAt: new Date(), progress: 100, result },
        $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
      }, session ? { session } : {});
      if (!claim.modifiedCount) throw new Stop();
    },
  };

  try {
    await opts.run(lease);
  } catch (error) {
    if (!(error instanceof Stop) && !(error instanceof Error && error.message === "STOP")) {
      const reason = opts.failure(error);
      console.error("job-failed", job.type, String(job._id), reason.code, error instanceof Error ? error.message.replaceAll(/\s+/g, " ").slice(0, 300) : "");
      const done = await Job.updateOne(held(), {
        $set: { state: "failed", finishedAt: new Date(), error: reason },
        $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 },
      });
      if (done.modifiedCount && opts.onFailed) await opts.onFailed(job).catch(() => {});
    }
  } finally {
    clearInterval(timer);
  }
  return true;
}

/** Restores a project badge that a failed or cancelled job left in a busy state. */
export async function settleBadge(job: { projectId: unknown; ownerId: unknown }) {
  await Project.updateOne({ _id: job.projectId, ownerId: job.ownerId, badge: { $in: ["planning", "rendering"] } }, { $set: { badge: "review" } });
}
