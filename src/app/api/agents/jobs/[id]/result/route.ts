import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDb, Job } from "../../../../../../server/db";
import { apiError } from "../../../../../../server/http";
import { json } from "../../../../../../server/guard";
import { agentFromRequest, agentHeld } from "../../../../../../server/agents";
import { publishMade } from "../../../../../../server/publish";
import { probeVideo } from "../../../../../../pipeline/render";
import { LAYOUTS } from "../../../../../../compiler/compile";

const metaSchema = z.object({
  leaseToken: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationMs: z.number().int().positive().max(20 * 60_000),
  warnings: z.array(z.string().max(300)).max(20).default([]),
  timing: z.enum(["aligned", "estimated"]).optional(),
  voiceId: z.string().max(80).optional(),
  renderer: z.string().max(120),
  commercial: z.boolean().default(false),
  silent: z.boolean().default(false),
  edl: z.unknown().optional(),
}).strict();

/**
 * The PC uploads its finished film. The server checks the file hash and re-runs its own QA on
 * the MP4 before publishing; the PC's word alone never makes a film current.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connectDb();
  const agent = await agentFromRequest(request);
  if (!agent) return apiError(401, "UNAUTHENTICATED", "AGENT_TOKEN", "This PC is not paired, or it was unpaired.");
  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That job is not here.");
  const form = await request.formData().catch(() => null);
  if (!form) return apiError(400, "VALIDATION", "INVALID_BODY", "Send the film as multipart form data.");
  const meta = metaSchema.safeParse(JSON.parse(String(form.get("meta") ?? "null")));
  if (!meta.success) return apiError(400, "VALIDATION", "INVALID_BODY", "The result metadata is not in the expected shape.");
  const held = () => agentHeld(id, agent._id, agent.ownerId, meta.data.leaseToken);
  const job = await Job.findOne(held());
  if (!job) return apiError(409, "CONFLICT", "LEASE_LOST", "This job is no longer yours.");
  const dir = mkdtempSync(join(tmpdir(), "ss-agent-"));
  try {
    const save = async (field: string, name: string, required: boolean) => {
      const file = form.get(field);
      if (!(file instanceof File)) { if (required) throw new Error(`Missing ${field}.`); return undefined; }
      const path = join(dir, name);
      writeFileSync(path, Buffer.from(await file.arrayBuffer()));
      return path;
    };
    const mp4 = (await save("mp4", "film.mp4", true))!;
    const digest = createHash("sha256").update((await import("node:fs")).readFileSync(mp4)).digest("hex");
    if (digest !== meta.data.sha256) return apiError(422, "VALIDATION", "HASH_MISMATCH", "The uploaded film does not match its hash. The PC should render again.");
    const thumb = (await save("thumb", "thumb.jpg", true))!;
    const sheet = (await save("sheet", "sheet.jpg", true))!;
    const srt = await save("srt", "captions.srt", false);
    const vtt = await save("vtt", "captions.vtt", false);
    const layout = LAYOUTS[job.input.format as keyof typeof LAYOUTS] ?? LAYOUTS["9x16"];
    const qa = await probeVideo(mp4, meta.data.durationMs, { width: layout.w, height: layout.h });
    if (meta.data.silent) { qa.checks = qa.checks.filter((c) => c.name !== "loudness" && c.name !== "true peak"); qa.passed = qa.checks.every((c) => c.ok); }
    const videoId = await publishMade({ job: { _id: job._id, ownerId: job.ownerId, projectId: job.projectId, input: job.input }, held }, {
      mp4, thumb, sheet, srt, vtt, durationMs: qa.durationMs, qa, warnings: [...meta.data.warnings, `Rendered on your paired PC "${agent.name}".`],
      timing: meta.data.timing, voiceId: meta.data.voiceId, renderer: `${meta.data.renderer}+agent`, commercial: meta.data.commercial,
      storyboardId: job.input.storyboardId, edl: meta.data.edl,
    }, (job.stages ?? []).map((s: { name: string }) => s.name));
    return json({ videoId: String(videoId), qaPassed: qa.passed }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "STOP") return apiError(409, "CONFLICT", "LEASE_LOST", "This job is no longer yours.");
    if (error instanceof Error && error.message.startsWith("Missing")) return apiError(400, "VALIDATION", "INVALID_BODY", error.message);
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
