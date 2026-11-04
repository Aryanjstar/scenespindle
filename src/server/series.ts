import { z } from "zod";
import mongoose from "mongoose";
import { Character, CharacterVersion, Project, Series, SeriesVersion } from "./db";

export function seriesJson(item: { _id: unknown; title: string; logline?: string; mode?: string; style?: string; bible?: { world?: string; tone?: string; rules?: string[] }; castIds?: unknown[]; revision?: number; version?: number; updatedAt?: Date }) {
  return {
    id: String(item._id), title: item.title, logline: item.logline ?? "", mode: item.mode ?? "story", style: item.style ?? "storybook",
    bible: { world: item.bible?.world ?? "", tone: item.bible?.tone ?? "", rules: item.bible?.rules ?? [] },
    castIds: (item.castIds ?? []).map(String), revision: item.revision ?? 1, version: item.version ?? 0, updatedAt: item.updatedAt,
  };
}

/** Freeze the bible and the exact cast versions. Episodes approved later keep this snapshot. */
export async function snapshotSeries(ownerId: unknown, seriesId: unknown, expectedRevision: number) {
  const session = await mongoose.startSession();
  try {
    let version = 0;
    await session.withTransaction(async () => {
      const series = await Series.findOneAndUpdate({ _id: seriesId, ownerId, revision: expectedRevision, deletedAt: { $exists: false } }, { $inc: { version: 1 } }, { new: true, session });
      if (!series) throw new Error("REVISION_CONFLICT");
      const cast = await Character.find({ _id: { $in: series.castIds }, ownerId }).session(session);
      const versions = await CharacterVersion.find({ characterId: { $in: cast.map((member) => member._id) }, ownerId }).sort({ version: -1 }).session(session);
      const snapshot = {
        ...seriesJson(series),
        cast: cast.map((member) => {
          const latest = versions.find((v) => String(v.characterId) === String(member._id));
          return { id: String(member._id), name: member.name, description: member.description, version: latest?.version ?? 0, sheetAssetId: latest ? String(latest.sheetAssetId) : null };
        }),
      };
      await SeriesVersion.create([{ ownerId, seriesId: series._id, version: series.version, snapshot }], { session });
      version = series.version;
    });
    return version;
  } finally {
    await session.endSession();
  }
}

/** Context the planner gets for an episode: bible, cast and what earlier episodes covered. */
export async function episodeContext(ownerId: unknown, seriesId: unknown, episodeNumber: number) {
  const series = await Series.findOne({ _id: seriesId, ownerId, deletedAt: { $exists: false } });
  if (!series) return null;
  const earlier = await Project.find({ ownerId, seriesId, episodeNumber: { $lt: episodeNumber } }).sort({ episodeNumber: 1 }).select("title episodeNumber").limit(20);
  return { title: series.title, world: series.bible?.world ?? "", tone: series.bible?.tone ?? "", rules: series.bible?.rules ?? [], previous: earlier.map((p) => `Episode ${p.episodeNumber}: ${p.title}`), castIds: series.castIds.map(String), style: series.style, mode: series.mode };
}

export const seriesBody = {
  title: z.string().trim().min(2).max(120),
  logline: z.string().trim().max(400),
  mode: z.enum(["story", "cartoon"]),
  style: z.enum(["flat", "cartoon", "storybook", "clay"]),
  world: z.string().trim().max(2000),
  tone: z.string().trim().max(400),
  rules: z.array(z.string().trim().min(1).max(200)).max(12),
  castIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(8),
};
