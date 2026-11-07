import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { validatePlan, type Plan } from "../contracts/plan";
import { stillPrompt } from "../pipeline/planner";
import { Asset, Character, CharacterVersion, Draft, Project } from "./db";
import { editImage, generateImage, imageConfig, sizeFor } from "./providers/images";
import { ProviderError } from "./providers/errors";
import { hashPlan } from "./studio";
import { fetchToFile, putBuffer } from "./storage";
import { meter } from "./usage";

const MODEL = () => `azure:${process.env.AZURE_IMAGE_DEPLOYMENT || "gpt-image"}`;

async function assetBytes(ownerId: unknown, assetId: unknown): Promise<Buffer | null> {
  if (!assetId || !mongoose.isValidObjectId(String(assetId))) return null;
  const asset = await Asset.findOne({ _id: assetId, ownerId, kind: "image" });
  if (!asset) return null;
  const dir = mkdtempSync(join(tmpdir(), "ss-img-"));
  try {
    return await readFile(await fetchToFile(asset.path, join(dir, "ref.png")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function saveGenerated(ownerId: unknown, name: string, data: Buffer, provenance: Record<string, unknown>, projectId?: unknown) {
  const id = new mongoose.Types.ObjectId();
  const key = `images/${String(ownerId)}/${String(id)}.png`;
  await putBuffer(key, data);
  return Asset.create({ _id: id, ownerId, kind: "image", name: name.slice(0, 120), path: key, mime: "image/png", licence: "generated-original", source: "generated", provenance: { ...provenance, model: MODEL(), at: new Date() }, projectId });
}

function requireImages() {
  const cfg = imageConfig();
  if (!cfg) throw new ProviderError("auth", "Image generation is not configured. Set AZURE_IMAGE_ENDPOINT and AZURE_IMAGE_KEY.");
  return cfg;
}

/** Turn the creator's reference image into a clean character sheet, saved as a new immutable version. */
export async function drawCharacter(ownerId: unknown, characterId: unknown, signal?: AbortSignal): Promise<{ version: number; sheetAssetId: string }> {
  const cfg = requireImages();
  const character = await Character.findOne({ _id: characterId, ownerId });
  if (!character) throw new Error("That character is not here.");
  const reference = await assetBytes(ownerId, character.referenceAssetId);
  const prompt = `Character sheet for an original ${character.style} character named ${character.name}. Full body, front view, relaxed neutral pose, centered, plain light background. ${reference ? "Keep the key features from the reference image: face shape, hair, skin tone, clothing and colours, redrawn in the chosen style." : ""} ${character.description} Original artwork, no text, no letters, no logos.`;
  if (signal?.aborted) throw new Error("STOP");
  const usage = await meter("images", 1, ownerId);
  let image: Buffer;
  try {
    image = reference ? await editImage(cfg, prompt, [reference], "1024x1536") : await generateImage(cfg, prompt, "1024x1536");
    await usage.settle();
  } catch (error) {
    await usage.release();
    throw error;
  }
  const asset = await saveGenerated(ownerId, `${character.name} sheet`, image, { kind: "character-sheet", characterId: String(character._id), referenceAssetId: character.referenceAssetId ? String(character.referenceAssetId) : null, prompt });
  const updated = await Character.findOneAndUpdate({ _id: character._id, ownerId }, { $inc: { version: 1 }, $set: { sheetAssetId: asset._id, state: "ready" } }, { new: true });
  await CharacterVersion.create({ ownerId, characterId: character._id, version: updated!.version, sheetAssetId: asset._id, referenceAssetId: character.referenceAssetId, style: character.style, description: character.description, model: MODEL() });
  return { version: updated!.version, sheetAssetId: String(asset._id) };
}

type Target = { sceneId: string; layerId: string; prompt: string; characterIds: string[]; style: string };

function targets(plan: Plan, sceneIds: string[], redraw: boolean): Target[] {
  const out: Target[] = [];
  for (const scene of plan.scenes) {
    if (sceneIds.length && !sceneIds.includes(scene.id)) continue;
    for (const layer of scene.layers) {
      if (layer.component !== "image.still@1") continue;
      if (layer.props.assetId && !redraw) continue;
      out.push({ sceneId: scene.id, layerId: layer.id, prompt: String(layer.props.prompt), characterIds: (layer.props.characterIds as string[] | undefined) ?? [], style: String(layer.props.style ?? (plan.mode === "cartoon" ? "cartoon" : "storybook")) });
    }
  }
  return out;
}

/**
 * Draw the stills a story storyboard asks for, using the cast's current sheets as
 * references, then write the new image ids into the draft. Only layers whose
 * description is unchanged since drawing started receive an image.
 */
export async function drawStills(ownerId: unknown, projectId: unknown, opts: { sceneIds?: string[]; redraw?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => Promise<void> } = {}): Promise<{ drawn: number }> {
  const cfg = requireImages();
  const project = await Project.findOne({ _id: projectId, ownerId });
  const draft = await Draft.findOne({ projectId, ownerId });
  const checked = validatePlan(draft?.plan);
  if (!project || !draft || !checked.plan) throw new Error("Plan a valid storyboard before drawing stills.");
  const work = targets(checked.plan, opts.sceneIds ?? [], Boolean(opts.redraw));
  if (!work.length) return { drawn: 0 };
  const castIds = [...new Set(work.flatMap((item) => item.characterIds))];
  const cast = await Character.find({ _id: { $in: castIds }, ownerId, sheetAssetId: { $exists: true } });
  const sheets = new Map<string, { name: string; bytes: Buffer }>();
  for (const member of cast) {
    const bytes = await assetBytes(ownerId, member.sheetAssetId);
    if (bytes) sheets.set(String(member._id), { name: member.name, bytes });
  }
  const results: { sceneId: string; layerId: string; prompt: string; assetId: string }[] = [];
  let done = 0;
  const queue = [...work];
  const size = sizeFor(checked.plan.format);
  // A failure (or a lost lease) in one lane stops the others, so no more pictures are paid for.
  let stopped = false;
  async function lane() {
    while (queue.length && !stopped && !opts.signal?.aborted) {
      const item = queue.shift()!;
      const refs = item.characterIds.map((id) => sheets.get(id)).filter((ref): ref is { name: string; bytes: Buffer } => Boolean(ref));
      const prompt = stillPrompt(item.style, item.prompt, refs);
      const usage = await meter("images", 1, ownerId);
      let image: Buffer;
      try {
        image = refs.length ? await editImage(cfg, prompt, refs.map((ref) => ref.bytes), size) : await generateImage(cfg, prompt, size);
        await usage.settle();
      } catch (error) {
        stopped = true;
        await usage.release();
        throw error;
      }
      const asset = await saveGenerated(ownerId, `${project!.title} ${item.sceneId}`, image, { kind: "story-still", projectId: String(projectId), sceneId: item.sceneId, prompt, characterIds: item.characterIds }, projectId);
      results.push({ sceneId: item.sceneId, layerId: item.layerId, prompt: item.prompt, assetId: String(asset._id) });
      done += 1;
      await opts.onProgress?.(done, work.length);
    }
  }
  await Promise.all([lane(), lane(), lane()]);
  if (opts.signal?.aborted) throw new Error("STOP");
  // Merge into the latest draft with a compare-and-swap; retry if the creator saved meanwhile.
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = await Draft.findOne({ projectId, ownerId });
    const plan = validatePlan(latest?.plan).plan;
    if (!latest || !plan) throw new Error("The storyboard changed and is no longer valid.");
    let applied = 0;
    const next = { ...plan, scenes: plan.scenes.map((scene) => ({ ...scene, layers: scene.layers.map((layer) => {
      const hit = results.find((result) => result.sceneId === scene.id && result.layerId === layer.id && result.prompt === layer.props.prompt);
      if (!hit) return layer;
      applied += 1;
      return { ...layer, props: { ...layer.props, assetId: hit.assetId } };
    }) })) };
    const checkedNext = validatePlan(next);
    if (!checkedNext.plan) throw new Error("The storyboard did not validate after drawing.");
    const saved = await Draft.findOneAndUpdate({ _id: latest._id, ownerId, revision: latest.revision }, { $set: { plan: checkedNext.plan, planValid: true, planHash: hashPlan(checkedNext.plan), issues: [] }, $inc: { revision: 1 } }, { new: true });
    if (saved) return { drawn: applied };
  }
  throw new Error("The storyboard kept changing while stills were saved. Draw again.");
}

/** Every still a story film needs must be drawn before approval. */
export function missingStills(plan: Plan): string[] {
  return plan.scenes.filter((scene) => scene.layers.some((layer) => layer.component === "image.still@1" && !layer.props.assetId)).map((scene) => scene.id);
}

/** Asset id → local file for the renderer, owner-scoped. */
export async function resolveStills(ownerId: unknown, plan: Plan, dir: string): Promise<Record<string, string>> {
  const ids = [...new Set(plan.scenes.flatMap((scene) => scene.layers.filter((layer) => layer.component === "image.still@1" && layer.props.assetId).map((layer) => String(layer.props.assetId))))];
  const assets = await Asset.find({ _id: { $in: ids }, ownerId, kind: "image" });
  const out: Record<string, string> = {};
  for (const asset of assets) out[String(asset._id)] = await fetchToFile(asset.path, join(dir, `still-${String(asset._id)}.png`));
  return out;
}
