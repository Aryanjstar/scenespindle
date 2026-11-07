import mongoose from "mongoose";
import { z } from "zod";
import { Draft, Trace } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { putBuffer } from "../../../../../server/storage";
import { ownProject } from "../../../../../server/studio";
import { traceSteps } from "../../../../../server/trace-load";

/** A JSON value small enough to show on screen: numbers, strings, booleans, null and short arrays. */
const scalar = z.union([z.number().finite(), z.string().max(200), z.boolean(), z.null()]);
const shown: z.ZodType<unknown> = z.lazy(() => z.union([scalar, z.array(shown).max(64), z.record(z.string().max(40), shown)]));

const stepSchema = z.object({
  line: z.number().int().min(0).max(10_000),
  event: z.enum(["call", "line", "return"]),
  stack: z.array(z.object({ name: z.string().max(60), locals: z.record(z.string().max(40), shown) }).passthrough()).max(64),
}).passthrough();

const bodySchema = z.object({
  language: z.enum(["python", "javascript"]),
  code: z.string().max(8000),
  entry: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/),
  input: z.array(shown).max(8),
  returned: shown.optional(),
  tracerVersion: z.string().regex(/^[a-z0-9-]+@\d+$/),
  steps: z.array(stepSchema).min(1).max(2000),
  summary: z.unknown().optional(),
}).strict();

/**
 * Save a trace recorded in the creator's browser. The server validates its shape and stores it;
 * it never executes the code. The draft revision moves, so a stale approval cannot pick it up.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  if (project.mode !== "code_lab") return apiError(422, "VALIDATION", "WRONG_MODE", "Traces belong to Code Lab projects.");
  const raw = await request.text();
  if (raw.length > 3_000_000) return apiError(413, "VALIDATION", "PAYLOAD_TOO_LARGE", "That trace is too big. Trace a smaller input.");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return apiError(400, "VALIDATION", "INVALID_BODY", "Send the trace as JSON."); }
  const parsed = bodySchema.safeParse(data);
  if (!parsed.success) return apiError(422, "VALIDATION", "TRACE_INVALID", `The trace is not in the expected shape (${parsed.error.issues[0]?.path.join(".") || "body"}).`);
  const body = parsed.data;
  const summary = { callCount: body.steps.filter((step) => step.event === "call").length, maxDepth: Math.max(...body.steps.map((step) => step.stack.length)), steps: body.steps.length };
  const traceId = new mongoose.Types.ObjectId();
  const stored = await putBuffer(`traces/${String(auth.user!._id)}/${String(traceId)}.json`, Buffer.from(JSON.stringify(body.steps)));
  const trace = await Trace.create({
    _id: traceId, ownerId: auth.user!._id, projectId: project._id, language: body.language, entry: body.entry, input: body.input, summary,
    tracerVersion: body.tracerVersion, code: body.code, returned: body.returned ?? null, steps: [], stepsKey: stored.key, stepCount: body.steps.length,
  });
  const draft = await Draft.findOneAndUpdate({ projectId: project._id, ownerId: auth.user!._id }, { $set: { traceId: trace._id }, $inc: { revision: 1 } }, { new: true });
  return json({ trace: { id: String(trace._id), summary }, revision: draft?.revision }, 201);
}

/** The project's current trace: metadata and steps, owner-only. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id }).select("traceId");
  const trace = draft?.traceId ? await Trace.findOne({ _id: draft.traceId, ownerId: auth.user!._id }) : null;
  if (!trace) return json({ trace: null });
  return json({ trace: { id: String(trace._id), language: trace.language, entry: trace.entry, input: trace.input, returned: trace.returned, code: trace.code, summary: trace.summary, steps: await traceSteps(trace), createdAt: trace.createdAt } });
}
