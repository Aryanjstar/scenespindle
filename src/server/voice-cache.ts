import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VoiceCacheStore, VoiceMeta } from "../pipeline/render";
import { fetchToFile, hasFile, putBuffer, putFile } from "./storage";

/**
 * Narration cache in object storage, keyed by a hash of voice + language + text. Clips survive
 * container restarts and deploys, so re-rendering unchanged lines never pays the provider again.
 * Keys hold no script text, only the hash.
 */
export const storageVoiceCache: VoiceCacheStore = {
  async get(key: string, dir: string): Promise<VoiceMeta | null> {
    if (!/^[a-f0-9]{16,64}$/.test(key)) return null;
    const metaKey = `voice-cache/${key}.json`;
    if (!(await hasFile(metaKey))) return null;
    const meta = JSON.parse(readFileSync(await fetchToFile(metaKey, resolve(dir, `${key}.remote.json`)), "utf8")) as VoiceMeta;
    if (meta.ext !== "mp3" && meta.ext !== "wav") return null;
    await fetchToFile(`voice-cache/${key}.${meta.ext}`, resolve(dir, `${key}.${meta.ext}`));
    return meta;
  },
  async put(key: string, dir: string, meta: VoiceMeta): Promise<void> {
    if (!/^[a-f0-9]{16,64}$/.test(key)) return;
    await putFile(`voice-cache/${key}.${meta.ext}`, resolve(dir, `${key}.${meta.ext}`));
    await putBuffer(`voice-cache/${key}.json`, Buffer.from(JSON.stringify(meta)));
  },
};
