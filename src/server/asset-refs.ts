import { Asset, Character, Draft, Job, Project, Storyboard, Style } from "./db";

/** Where an asset is still used. A used file cannot be deleted; approved films keep their inputs. */
export async function assetUses(ownerId: unknown, id: string): Promise<string[]> {
  const uses: string[] = [];
  if (await Storyboard.exists({ ownerId, $or: [{ "plan.songAssetId": id }, { "plan.scenes.layers.props.assetId": id }] })) uses.push("an approved storyboard");
  if (await Draft.exists({ ownerId, $or: [{ "plan.songAssetId": id }, { "plan.scenes.layers.props.assetId": id }] })) uses.push("a storyboard draft");
  if (await Project.exists({ ownerId, $or: [{ "lyrics.songAssetId": id }, { "montage.assetIds": id }, { "montage.musicAssetId": id }, { "montage.reel.assetId": id }] })) uses.push("a project's settings");
  if (await Character.exists({ ownerId, $or: [{ referenceAssetId: id }, { sheetAssetId: id }] })) uses.push("a character");
  if (await Style.exists({ ownerId, sourceAssetIds: id })) uses.push("a saved style");
  if (await Job.exists({ ownerId, state: { $in: ["queued", "running", "waiting_quota"] }, $or: [{ "input.assetIds": id }, { "input.musicAssetId": id }, { "input.assetId": id }] })) uses.push("a job in progress");
  return uses;
}

export async function softDeleteAsset(ownerId: unknown, id: string) {
  return Asset.findOneAndUpdate({ _id: id, ownerId, deletedAt: { $exists: false } }, { $set: { deletedAt: new Date() } }, { new: true });
}
