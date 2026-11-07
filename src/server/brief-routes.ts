import mongoose from "mongoose";
import { z } from "zod";
import { briefAnswerSchema, briefInputSchema, type BriefInput } from "../brief/contract";
import { Brief, Project, Series } from "./db";
import { authed, busy, json } from "./guard";
import { apiError } from "./http";
import { briefError } from "./brief-http";
import { answerProjectBrief, approveProjectBrief, refineProjectBrief, type BriefScope } from "./briefs";
import { enqueue } from "./jobs";
import { loadEnv } from "../config/env";

/**
 * One set of brief handlers for both scopes. A project brief drives that film; a series brief
 * (stored under the series id) carries objective, audience and must-haves into every episode.
 */
type Ctx = { params: Promise<{ id: string }> };

async function scopeOf(ownerId: mongoose.Types.ObjectId, id: string, scope: "project" | "series"): Promise<BriefScope | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  if (scope === "project") {
    const project = await Project.findOne({ _id: id, ownerId });
    return project ? { _id: project._id, scope, mode: project.mode, format: project.format, language: project.language, targetMs: project.targetMs } : null;
  }
  const series = await Series.findOne({ _id: id, ownerId, deletedAt: { $exists: false } });
  return series ? { _id: series._id, scope, mode: series.mode ?? "story", format: "9x16", language: "en", targetMs: 60000 } : null;
}

const missing = (scope: string) => apiError(404, "NOT_FOUND", "NOT_FOUND", scope === "series" ? "That series is not here." : "That project is not here.");
const body = async (request: Request) => request.json().catch(() => null);

function view(brief: { revision: number; version: number; input: unknown; result: unknown; state: string; approvedAt?: Date | null; research?: unknown }) {
  return { revision: brief.revision, version: brief.version, input: brief.input, result: brief.result, state: brief.state, approvedAt: brief.approvedAt ?? null, research: brief.research ?? null };
}

export function briefHandlers(scope: "project" | "series") {
  return {
    GET: async (_request: Request, ctx: Ctx) => {
      const auth = await authed();
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      const brief = await Brief.findOne({ ownerId: auth.user!._id, projectId: target._id });
      return json({ brief: brief ? view(brief) : null });
    },
    /** Merge edited fields into the brief. A new revision; an approved brief returns to review. */
    PATCH: async (request: Request, ctx: Ctx) => {
      const auth = await authed(request);
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      const parsed = z.object({ expectedRevision: z.number().int().positive(), fields: briefInputSchema.partial() }).strict().safeParse(await body(request));
      if (!parsed.success) return apiError(400, "VALIDATION", "INVALID_BRIEF", "Check the brief fields.", { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
      const current = await Brief.findOne({ ownerId: auth.user!._id, projectId: target._id });
      if (!current) return apiError(404, "NOT_FOUND", "NOT_FOUND", "Write the brief first.");
      try {
        const merged = { ...(current.input as BriefInput), ...parsed.data.fields };
        const brief = await refineProjectBrief(target, auth.user!._id, parsed.data.expectedRevision, merged);
        return json(view(brief));
      } catch (error) { return briefError(error); }
    },
    refine: async (request: Request, ctx: Ctx) => {
      const auth = await authed(request);
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      try {
        const parsed = z.object({ expectedRevision: z.number().int().min(0), input: z.unknown() }).strict().parse(await body(request));
        const brief = await refineProjectBrief(target, auth.user!._id, parsed.expectedRevision, parsed.input);
        return json(view(brief));
      } catch (error) { return briefError(error); }
    },
    answers: async (request: Request, ctx: Ctx) => {
      const auth = await authed(request);
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      try {
        const parsed = briefAnswerSchema.parse(await body(request));
        const brief = await answerProjectBrief(target, auth.user!._id, parsed.expectedRevision, parsed.choice);
        return json(view(brief));
      } catch (error) { return briefError(error); }
    },
    approve: async (request: Request, ctx: Ctx) => {
      const auth = await authed(request);
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      try {
        const parsed = z.object({ expectedRevision: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await body(request));
        return json(await approveProjectBrief(target._id, auth.user!._id, parsed.expectedRevision, parsed.contentHash));
      } catch (error) { return briefError(error); }
    },
    /** Bounded web research for the brief (up to 3 searches, 5 sources), run in the worker. */
    research: async (request: Request, ctx: Ctx) => {
      const auth = await authed(request);
      if ("error" in auth && auth.error) return auth.error;
      const target = await scopeOf(auth.user!._id, (await ctx.params).id, scope);
      if (!target) return missing(scope);
      if (!loadEnv().geminiApiKey) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", "Research needs the planner key.");
      const brief = await Brief.findOne({ ownerId: auth.user!._id, projectId: target._id });
      if (!brief) return apiError(404, "NOT_FOUND", "NOT_FOUND", "Write the brief first.");
      if ((brief.input as BriefInput).researchMode === "off") return apiError(422, "VALIDATION", "RESEARCH_OFF", "Research is switched off for this brief.");
      try {
        const jobId = await enqueue({ ownerId: auth.user!._id, scopeId: target._id, type: "brief_refine", input: { scope, revision: brief.revision }, stages: ["research"] });
        await Brief.updateOne({ _id: brief._id }, { $set: { research: { status: "running", at: new Date() } } });
        return json({ jobId }, 202);
      } catch (error) {
        return busy(error) ?? apiError(500, "FAILED", "FAILED", "Could not start research.");
      }
    },
  };
}
