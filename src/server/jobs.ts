import mongoose from "mongoose";
import { Job } from "./db";

export type JobType = "image" | "render" | "brainstorm" | "plan" | "revise" | "scene_regen" | "caption" | "brief_refine" | "analysis" | "export" | "tool";

type EnqueueOptions = {
  ownerId: unknown;
  /** The project (or character, series, style) whose single active slot this job takes. */
  scopeId: unknown;
  type: JobType;
  input: Record<string, unknown>;
  stages: string[];
  target?: "hosted" | "paired-agent";
  session?: mongoose.ClientSession;
};

/** Queue a job in the scope's single active slot. Throws PROJECT_BUSY when one is active. */
export async function enqueue(opts: EnqueueOptions): Promise<string> {
  if (opts.session) return create(opts, opts.session);
  const session = await mongoose.startSession();
  try {
    let id = "";
    await session.withTransaction(async () => { id = await create(opts, session); });
    return id;
  } finally {
    await session.endSession();
  }
}

function busyError(jobId?: string) {
  const error = new Error("PROJECT_BUSY") as Error & { jobId?: string };
  error.jobId = jobId;
  return error;
}

async function create(opts: EnqueueOptions, session: mongoose.ClientSession): Promise<string> {
  const active = await Job.findOne({ projectId: opts.scopeId, activeSlot: true, state: { $in: ["queued", "running", "waiting_quota"] } }).session(session);
  if (active) throw busyError(String(active._id));
  try {
    const [job] = await Job.create([{
      ownerId: opts.ownerId, projectId: opts.scopeId, type: opts.type, state: "queued", activeSlot: true,
      target: opts.target ?? "hosted", input: opts.input, stages: opts.stages.map((name) => ({ name, state: "queued" })),
      attempts: 0, runAfter: new Date(),
    }], { session });
    return String(job._id);
  } catch (error) {
    // The partial unique index on the active slot is the final guard against a race.
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) throw busyError();
    throw error;
  }
}
