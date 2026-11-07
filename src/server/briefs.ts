import mongoose from 'mongoose';
import { briefInputSchema, compileBriefPrompts, refineBrief, type BriefInput } from '../brief/contract';
import { Brief, BriefVersion, Draft, Project } from './db';

export class BriefConflict extends Error {
  constructor(public currentRevision: number) { super('REVISION_CONFLICT'); }
}
export class BriefIncomplete extends Error { constructor() { super('BRIEF_INCOMPLETE'); } }

export async function ownBriefProject(ownerId: mongoose.Types.ObjectId, id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Project.findOne({ _id: id, ownerId });
}

export type BriefScope = { _id: mongoose.Types.ObjectId; scope?: 'project' | 'series'; mode: string; format: string; language: string; targetMs: number };

async function contextFor(project: BriefScope, ownerId: mongoose.Types.ObjectId) {
  const draft = project.scope === 'series' ? null : await Draft.findOne({ ownerId, projectId: project._id }).select('idea.audience');
  return { projectId: String(project._id), mode: project.mode, format: project.format, language: project.language, targetMs: project.targetMs, inheritedAudience: draft?.idea?.audience };
}

export async function refineProjectBrief(project: BriefScope, ownerId: mongoose.Types.ObjectId, expectedRevision: number, rawInput: unknown) {
  const input = briefInputSchema.parse(rawInput);
  const result = refineBrief(input, await contextFor(project, ownerId));
  if (expectedRevision === 0) {
    try {
      return await Brief.create({ ownerId, projectId: project._id, scope: project.scope ?? 'project', revision: 1, version: 0, input, result, state: result.state });
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
        const current = await Brief.findOne({ ownerId, projectId: project._id }).select('revision');
        throw new BriefConflict(current?.revision ?? 1);
      }
      throw error;
    }
  }
  const updated = await Brief.findOneAndUpdate(
    { ownerId, projectId: project._id, revision: expectedRevision },
    { $set: { input, result, state: result.state }, $inc: { revision: 1 }, $unset: { approvedAt: 1 } },
    { new: true },
  );
  if (updated) return updated;
  const current = await Brief.findOne({ ownerId, projectId: project._id }).select('revision');
  throw new BriefConflict(current?.revision ?? 0);
}

export async function answerProjectBrief(project: BriefScope, ownerId: mongoose.Types.ObjectId, expectedRevision: number, choice: 'clear' | 'story' | 'visual') {
  const current = await Brief.findOne({ ownerId, projectId: project._id, revision: expectedRevision });
  if (!current) {
    const latest = await Brief.findOne({ ownerId, projectId: project._id }).select('revision');
    throw new BriefConflict(latest?.revision ?? 0);
  }
  const input = { ...(current.input as BriefInput), directionId: choice };
  return refineProjectBrief(project, ownerId, expectedRevision, input);
}

export async function approveProjectBrief(projectId: mongoose.Types.ObjectId, ownerId: mongoose.Types.ObjectId, expectedRevision: number, contentHash: string) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const current = await Brief.findOne({ projectId, ownerId }).session(session);
      if (!current || current.revision !== expectedRevision || current.result?.contentHash !== contentHash) throw new BriefConflict(current?.revision ?? 0);
      if (current.state === 'approved') {
        const prior = await BriefVersion.findOne({ briefId: current._id, version: current.version, ownerId }).session(session);
        if (!prior) throw new BriefConflict(current.revision);
        return { briefVersionId: String(prior._id), version: prior.version, contentHash: prior.contentHash };
      }
      if (current.state !== 'ready_for_review' || current.result.state !== 'ready_for_review') throw new BriefIncomplete();
      // Research (when run) travels with the approved snapshot, labelled with its sources and dates.
      const research = current.research?.status === 'done' ? current.research : null;
      const snapshot = { ...current.result, ...(research ? { research: { mode: current.result.research?.mode ?? 'auto', status: 'done', note: research.summary, sources: research.sources, retrievedAt: research.at } } : {}) };
      const promptBundle = compileBriefPrompts(snapshot);
      const version = current.version + 1;
      const updated = await Brief.updateOne({ _id: current._id, ownerId, revision: expectedRevision }, { $set: { state: 'approved', approvedAt: new Date() }, $inc: { version: 1 } }, { session });
      if (updated.modifiedCount !== 1) throw new BriefConflict(expectedRevision);
      const [saved] = await BriefVersion.create([{ ownerId, projectId, briefId: current._id, version, contentHash, snapshot, promptBundle, approvedAt: new Date() }], { session });
      return { briefVersionId: String(saved._id), version, contentHash };
    });
  } finally { await session.endSession(); }
}
