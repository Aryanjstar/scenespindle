import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ProviderKeys, type VoiceEntry, voiceUnavailable } from "../../config/providers";
import { azureSpeak } from "./azure-speech";
import { listVoices, synthesize, type WordTiming } from "./elevenlabs";
import { ProviderError } from "./errors";
import { sarvamSpeak } from "./sarvam";

export type Take = {
  audio: Buffer;
  ext: "mp3" | "wav";
  /** Word times relative to the start of this clip. */
  words: WordTiming[];
  timing: "aligned" | "estimated";
  model: string;
};

const voiceIdCache = new Map<string, string>();

async function elevenVoiceId(apiKey: string, name: string): Promise<string> {
  const cached = voiceIdCache.get(name);
  if (cached) return cached;
  const voices = await listVoices(apiKey);
  const hit = voices.find((voice) => voice.name.toLowerCase().startsWith(name.toLowerCase()));
  // The chosen narrator never silently changes to a different voice.
  if (!hit) throw new ProviderError("invalid", `The voice "${name}" is not available on this ElevenLabs account.`);
  voiceIdCache.set(name, hit.id);
  return hit.id;
}

/** Duration of an audio buffer measured by ffprobe, in ms. */
export function measureMs(audio: Buffer, ext: string): number {
  const dir = mkdtempSync(join(tmpdir(), "ss-probe-"));
  try {
    const file = join(dir, `clip.${ext}`);
    writeFileSync(file, audio);
    const raw = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    const seconds = Number(raw.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Could not measure the narration.");
    return Math.round(seconds * 1000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Spread words over a measured clip length, weighted by length. Used only when the
 * provider returns no timestamps; the result is always labelled "estimated".
 */
export function estimateWords(text: string, durationMs: number, leadMs = 80, tailMs = 120): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  const span = Math.max(durationMs - leadMs - tailMs, words.length * 60);
  const weights = words.map((word) => Math.max(2, word.replace(/[^\p{L}\p{N}]/gu, "").length) + 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = leadMs;
  return words.map((word, index) => {
    const length = (weights[index] / total) * span;
    const start = Math.round(cursor);
    cursor += length;
    return { text: word, startMs: start, endMs: Math.max(start + 40, Math.round(cursor) - 20) };
  });
}

function toneTake(text: string): Take {
  const words = text.split(/\s+/).filter(Boolean);
  const seconds = Math.max(1.2, words.length * 0.36);
  const dir = mkdtempSync(join(tmpdir(), "ss-tone-"));
  try {
    const file = join(dir, "tone.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds.toFixed(2)}:sample_rate=48000`, "-af", "volume=0.25", "-ac", "1", file]);
    const audio = readFileSync(file);
    return { audio, ext: "wav", words: estimateWords(text, Math.round(seconds * 1000)), timing: "estimated", model: "ffmpeg-sine" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One spoken line through the configured adapter for this voice. */
export async function speak(entry: VoiceEntry, text: string, keys: ProviderKeys, language: "en" | "hi" | "hinglish" = "en"): Promise<Take> {
  const blocked = voiceUnavailable(entry, keys, language);
  if (blocked) throw new ProviderError("auth", blocked);
  if (entry.provider === "azure") {
    const lang = language === "hi" ? "hi-IN" : "en-IN";
    const take = await azureSpeak({ key: keys.azureSpeechKey ?? "", region: keys.azureSpeechRegion ?? "centralindia", voice: entry.ref, text, lang });
    if (take.words.length) return { audio: take.audio, ext: "mp3", words: take.words, timing: "aligned", model: take.model };
    const ms = measureMs(take.audio, "mp3");
    return { audio: take.audio, ext: "mp3", words: estimateWords(text, ms), timing: "estimated", model: take.model };
  }
  if (entry.provider === "elevenlabs") {
    const voiceId = await elevenVoiceId(keys.elevenLabsApiKey, entry.ref);
    const take = await synthesize({ apiKey: keys.elevenLabsApiKey, voiceId, text });
    return { audio: take.audio, ext: "mp3", words: take.words, timing: "aligned", model: take.model };
  }
  if (entry.provider === "sarvam") {
    const take = await sarvamSpeak({ apiKey: keys.sarvamApiKey, text, language: language === "en" ? "en-IN" : "hi-IN", speaker: entry.ref });
    const ms = measureMs(take.audio, "wav");
    return { audio: take.audio, ext: "wav", words: estimateWords(text, ms), timing: "estimated", model: take.model };
  }
  return toneTake(text);
}
