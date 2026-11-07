import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import type { CompileTrace } from "../compiler/compile";
import type { TraceStep } from "../trace/interpret";
import { keyStates } from "../trace/states";
import { Trace } from "./db";
import { fetchToFile } from "./storage";

/** Steps of a recorded trace: from storage for new traces, inline for older ones. */
export async function traceSteps(trace: { steps?: TraceStep[]; stepsKey?: string }): Promise<TraceStep[]> {
  if (!trace.stepsKey) return trace.steps ?? [];
  const dir = mkdtempSync(join(tmpdir(), "ss-trace-"));
  try {
    return JSON.parse(readFileSync(await fetchToFile(trace.stepsKey, join(dir, "steps.json")), "utf8")) as TraceStep[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Load a recorded trace (owner-scoped) and derive its visual states with trusted code. */
export async function loadTrace(ownerId: unknown, traceId: unknown): Promise<(CompileTrace & { entry: string; input: unknown; returned: unknown; language: string }) | null> {
  if (!traceId || !mongoose.isValidObjectId(String(traceId))) return null;
  const trace = await Trace.findOne({ _id: traceId, ownerId }).lean<{ steps?: TraceStep[]; stepsKey?: string; code?: string; entry: string; input: unknown; returned?: unknown; language?: string }>();
  if (!trace) return null;
  const steps = await traceSteps(trace);
  return { states: keyStates(steps), code: trace.code, entry: trace.entry, input: trace.input, returned: trace.returned ?? null, language: trace.language ?? "python" };
}
