import mongoose from "mongoose";
import { Job } from "./db";

/** Queue a job in the scope's single active slot. Throws PROJECT_BUSY when one is running. */
export async function enqueue(opts: { ownerId: unknown; scopeId: unknown; type: "image" | "render"; input: Record<string, unknown>; stages: string[] }): Promise<string> {
  const session = await mongoose.startSession();
  try {
    let id = "";
    await session.withTransaction(async () => {
      const active = await Job.findOne({ projectId: opts.scopeId, activeSlot: true, state: { $in: ["queued", "running", "waiting_quota"] } }).session(session);
      if (active) {
        const error = new Error("PROJECT_BUSY") as Error & { jobId?: string };
        error.jobId = String(active._id);
        throw error;
      }
      const [job] = await Job.create([{ ownerId: opts.ownerId, projectId: opts.scopeId, type: opts.type, state: "queued", activeSlot: true, input: opts.input, stages: opts.stages.map((name) => ({ name, state: "queued" })), attempts: 0, runAfter: new Date() }], { session });
      id = String(job._id);
    });
    return id;
  } finally {
    await session.endSession();
  }
}
