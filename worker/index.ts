import mongoose from "mongoose";
import { connectDb } from "../src/server/db";
import { sweepDeleted } from "../src/server/cleanup";
import { processImages } from "./images";
import { processPlanning } from "./planning";
import { processPreview } from "./preview";
import { processRender } from "./render";
import { processTasks } from "./tasks";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
await connectDb();
await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createIndexes().catch(() => console.error("index-sync-failed", name))));
console.log("SceneSpindle worker started (planning, preview, images, film, montage, captions, styles, exports)");

/** One lane per kind of work, so slow image jobs never hold up a film render. */
async function lane(name: string, step: () => Promise<boolean>, idleMs: number) {
  while (!stopping) {
    try {
      if (!(await step())) await new Promise((resolve) => setTimeout(resolve, idleMs));
    } catch {
      console.error("worker-lane-unavailable", name);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

let nextSweep = 0;
async function sweep(): Promise<boolean> {
  if (Date.now() < nextSweep) return false;
  nextSweep = Date.now() + 10 * 60_000;
  const erased = await sweepDeleted();
  if (erased) console.log("cleanup-erased", erased);
  return false;
}

await Promise.all([
  lane("render", async () => (await processPreview()) || (await processRender()), 750),
  lane("planning", processPlanning, 500),
  lane("images", processImages, 1500),
  lane("tasks", processTasks, 1500),
  lane("cleanup", sweep, 30_000),
]);
await mongoose.disconnect();
