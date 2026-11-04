import { Draft, Trace } from "../../../../../server/db";
import { apiError } from "../../../../../server/http";
import { authed, json } from "../../../../../server/guard";
import { ownProject } from "../../../../../server/studio";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed(request);
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const project = await ownProject(auth.user!._id, id);
  if (!project) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That project is not here.");
  const raw = await request.text();
  if (raw.length > 3_000_000) return apiError(413, "VALIDATION", "PAYLOAD_TOO_LARGE", "That trace is too big.");
  let body: { language?: string; code?: string; entry?: string; input?: unknown; returned?: unknown; tracerVersion?: string; steps?: { line?: number; event?: string; stack?: unknown[] }[] };
  try { body = JSON.parse(raw); } catch { return apiError(400, "VALIDATION", "INVALID_BODY", "Send the trace as JSON."); }
  const steps = body.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 2000) {
    return apiError(422, "VALIDATION", "TRACE_INVALID", "A trace needs 1 to 2,000 steps.");
  }
  if (steps.some((step) => typeof step.line !== "number" || !step.event || !Array.isArray(step.stack))) {
    return apiError(422, "VALIDATION", "TRACE_INVALID", "A step needs a line, an event, and a stack.");
  }
  const summary = {
    callCount: steps.filter((step) => step.event === "call").length,
    maxDepth: Math.max(...steps.map((step) => step.stack?.length ?? 0)),
  };
  const trace = await Trace.create({
    ownerId: auth.user!._id,
    projectId: project._id,
    language: body.language || "python",
    entry: typeof body.entry === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(body.entry) ? body.entry : "main",
    input: body.input ?? [],
    summary,
    tracerVersion: body.tracerVersion || "leela-trace@1",
    // Stored as text for the code listing scene. The server never runs it.
    code: typeof body.code === "string" ? body.code.slice(0, 8000) : undefined,
    returned: typeof body.returned === "number" || typeof body.returned === "string" || body.returned === null ? body.returned : undefined,
    steps,
  });
  const draft = await Draft.findOne({ projectId: project._id, ownerId: auth.user!._id });
  if (draft) {
    draft.traceId = trace._id;
    await draft.save();
  }
  return json({ trace: { id: String(trace._id), summary } }, 201);
}
