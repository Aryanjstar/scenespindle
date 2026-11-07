import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { validatePlan } from "../contracts/plan";
import { Agent, Asset, Job, Project, Storyboard } from "./db";
import { hashToken } from "./session";
import { signAssetUrl } from "./signed";
import { loadTrace } from "./trace-load";
import { appEnv } from "../config/app";

/**
 * Paired PCs. A creator pairs a machine with a one-time code; the machine gets its own token
 * (stored as an HMAC), can claim only that creator's jobs marked for a paired PC, and never
 * receives database or provider credentials. Revoking or expiry stops claims at once.
 */
export const AGENT_LEASE_MS = 120_000;

export function newPairingCode(): string {
  // 10 characters without look-alikes, shown once.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

export function newAgentToken(): string {
  return `sa_${randomBytes(32).toString("base64url")}`;
}

export async function agentFromRequest(request: Request) {
  const match = /^Bearer\s+(sa_[A-Za-z0-9_-]{40,60})$/.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match) return null;
  const agent = await Agent.findOneAndUpdate(
    { tokenHash: hashToken(match[1]), revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { lastSeenAt: new Date() } },
    { new: true },
  );
  return agent;
}

export function agentJson(agent: { _id: unknown; name: string; capabilities?: Record<string, unknown>; lastSeenAt?: Date; expiresAt: Date; revokedAt?: Date; tokenHash?: string; pairingExpiresAt?: Date; createdAt?: Date }) {
  return {
    id: String(agent._id), name: agent.name, capabilities: agent.capabilities ?? {}, lastSeenAt: agent.lastSeenAt ?? null, expiresAt: agent.expiresAt,
    revokedAt: agent.revokedAt ?? null, paired: Boolean(agent.tokenHash), pairingExpiresAt: agent.tokenHash ? null : agent.pairingExpiresAt ?? null, createdAt: agent.createdAt,
    online: Boolean(agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 90_000),
  };
}

/** Frozen inputs a paired PC needs for one job: the plan and signed links to the creator's files. */
async function inputsFor(job: { _id: unknown; ownerId: unknown; projectId: unknown; input: Record<string, unknown> }) {
  const origin = appEnv().origin;
  const link = (id: unknown) => `${origin}${signAssetUrl(String(id), 6 * 3600, "agent")}`;
  if (job.input.output === "montage") {
    const ids = [...((job.input.assetIds as string[]) ?? []), ...(job.input.musicAssetId ? [String(job.input.musicAssetId)] : [])];
    const assets = await Asset.find({ _id: { $in: ids }, ownerId: job.ownerId });
    const byId = new Map(assets.map((a) => [String(a._id), a]));
    return {
      kind: "montage",
      clips: ((job.input.assetIds as string[]) ?? []).map((id) => ({ url: link(id), kind: byId.get(String(id))?.kind, ext: byId.get(String(id))?.path.split(".").pop() })),
      music: job.input.musicAssetId ? { url: link(job.input.musicAssetId), ext: byId.get(String(job.input.musicAssetId))?.path.split(".").pop() } : null,
      seconds: job.input.seconds, format: job.input.format, settings: job.input.settings ?? {}, learned: job.input.learned ?? null,
    };
  }
  const storyboard = await Storyboard.findOne({ _id: job.input.storyboardId, ownerId: job.ownerId, projectId: job.projectId });
  const checked = validatePlan(storyboard?.plan);
  if (!storyboard || !checked.plan) throw new Error("The approved storyboard is not valid.");
  const plan = checked.plan;
  const stills = [...new Set(plan.scenes.flatMap((s) => s.layers.filter((l) => l.component === "image.still@1" && l.props.assetId).map((l) => String(l.props.assetId))))];
  const project = await Project.findOne({ _id: job.projectId, ownerId: job.ownerId }).select("renderProfile");
  return {
    kind: "film", plan, voiceId: job.input.voiceId ?? null, format: job.input.format, storyboardId: String(storyboard._id),
    profile: project?.renderProfile === "cinematic-3d" ? "cinematic-3d" : "standard",
    trace: plan.mode === "code_lab" ? await loadTrace(job.ownerId, storyboard.traceId) : null,
    stills: Object.fromEntries(stills.map((id) => [id, link(id)])),
    song: plan.mode === "lyrics" && plan.songAssetId ? link(plan.songAssetId) : null,
  };
}

/** Claim the creator's next paired-PC job. Only jobs this agent's owner queued for a paired PC. */
export async function claimForAgent(agent: { _id: mongoose.Types.ObjectId; ownerId: mongoose.Types.ObjectId; capabilities?: Record<string, unknown> }) {
  const now = new Date();
  const token = randomUUID();
  const job = await Job.findOneAndUpdate({
    ownerId: agent.ownerId, target: "paired-agent", type: "render", attempts: { $lt: 3 },
    $or: [{ state: "queued", runAfter: { $lte: now } }, { state: "running", leaseExpiresAt: { $lte: now } }],
  }, { $set: { state: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + AGENT_LEASE_MS), agentId: agent._id, startedAt: now }, $inc: { attempts: 1 } }, { sort: { runAfter: 1, _id: 1 }, new: true });
  if (!job) return null;
  try {
    return { id: String(job._id), leaseToken: token, leaseMs: AGENT_LEASE_MS, output: job.input.output, inputs: await inputsFor(job) };
  } catch (error) {
    await Job.updateOne({ _id: job._id, leaseToken: token }, { $set: { state: "failed", finishedAt: new Date(), error: { code: "INPUT_INVALID", message: error instanceof Error ? error.message : "Inputs missing.", retryable: false } }, $unset: { activeSlot: 1, leaseToken: 1, leaseExpiresAt: 1 } });
    return null;
  }
}

/** Filter that matches only while this agent still holds the job's lease. */
export function agentHeld(jobId: string, agentId: unknown, ownerId: unknown, leaseToken: string) {
  return { _id: new mongoose.Types.ObjectId(jobId), ownerId, agentId, state: "running", leaseToken, leaseExpiresAt: { $gt: new Date() } };
}
