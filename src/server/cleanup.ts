import { Asset, Brief, BriefVersion, Draft, Job, Message, Project, ShareLink, Storyboard, Trace, Video } from "./db";
import { assetUses } from "./asset-refs";
import { removePrefix } from "./storage";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Erase projects that were deleted more than seven days ago, with everything that
 * belongs to them, including stored films. Returns how many projects were erased.
 */
export async function sweepDeleted(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const due = await Project.find({ deletedAt: { $lte: cutoff } }, null, { withDeleted: true }).limit(20).select("_id ownerId");
  for (const project of due) {
    const filter = { projectId: project._id, ownerId: project.ownerId };
    const active = await Job.exists({ ...filter, state: "running", leaseExpiresAt: { $gt: now } });
    if (active) continue;
    const videos = await Video.find(filter).select("_id artifacts");
    for (const video of videos) {
      if (video.artifacts?.mp4) await removePrefix(`videos/${String(project.ownerId)}/${String(video._id)}`);
    }
    await Promise.all([
      Video.deleteMany(filter), Storyboard.deleteMany(filter), Draft.deleteMany(filter), Message.deleteMany(filter),
      Job.deleteMany(filter), Trace.deleteMany(filter), Brief.deleteMany(filter), BriefVersion.deleteMany(filter), ShareLink.deleteMany(filter),
    ]);
    await Project.deleteOne({ _id: project._id, ownerId: project.ownerId }, { withDeleted: true });
  }
  // Library files deleted more than seven days ago, if nothing came to use them meanwhile.
  const files = await Asset.find({ deletedAt: { $lte: cutoff } }).limit(50).select("_id ownerId path");
  for (const asset of files) {
    if ((await assetUses(asset.ownerId, String(asset._id))).length) { await Asset.updateOne({ _id: asset._id }, { $unset: { deletedAt: 1 } }); continue; }
    await removePrefix(asset.path).catch(() => {});
    await Asset.deleteOne({ _id: asset._id });
  }
  return due.length;
}
