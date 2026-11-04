import mongoose from "mongoose";
import type { CompileTrace } from "../compiler/compile";
import type { TraceStep } from "../trace/interpret";
import { keyStates } from "../trace/states";
import { Trace } from "./db";

/** Load a recorded trace (owner-scoped) and derive its visual states with trusted code. */
export async function loadTrace(ownerId: unknown, traceId: unknown): Promise<(CompileTrace & { entry: string; input: unknown; returned: unknown }) | null> {
  if (!traceId || !mongoose.isValidObjectId(String(traceId))) return null;
  const trace = await Trace.findOne({ _id: traceId, ownerId }).lean<{ steps: TraceStep[]; code?: string; entry: string; input: unknown; returned?: unknown }>();
  if (!trace) return null;
  return { states: keyStates(trace.steps), code: trace.code, entry: trace.entry, input: trace.input, returned: trace.returned ?? null };
}
