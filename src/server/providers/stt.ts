import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, type Env } from "../../config/env";
import { ProviderError, classifyStatus } from "./errors";

export type HeardWord = { text: string; startMs: number; endMs: number };
export type Transcript = { words: HeardWord[]; language: string; via: "elevenlabs" | "whisper.cpp"; model: string };

function whisperModel(): string | null {
  const path = process.env.WHISPER_MODEL || "";
  return path && existsSync(path) ? path : null;
}

function whisperBinary(): string | null {
  const bin = process.env.WHISPER_CLI || "whisper-cli";
  return spawnSync(bin, ["--help"], { stdio: "ignore", timeout: 5000 }).status === 0 ? bin : null;
}

/** Which transcription route is configured. ElevenLabs Scribe first; local whisper.cpp when installed. */
export function sttAvailable(env: Env): { available: boolean; via: "elevenlabs" | "whisper.cpp" | null; reason?: string } {
  if (env.elevenLabsApiKey) return { available: true, via: "elevenlabs" };
  if (whisperModel() && whisperBinary()) return { available: true, via: "whisper.cpp" };
  return { available: false, via: null, reason: "Set ELEVENLABS_API_KEY, or install whisper.cpp and set WHISPER_MODEL to a ggml model file. You can still paste SRT or LRC times." };
}

/** Word-level transcript of a WAV/MP3 file. The route chosen is reported; nothing falls back silently. */
export async function transcribe(env: Env, audioFile: string, language?: "en" | "hi"): Promise<Transcript> {
  const route = sttAvailable(env);
  if (route.via === "elevenlabs") return scribe(env.elevenLabsApiKey, audioFile, language);
  if (route.via === "whisper.cpp") return whisperCpp(audioFile, language);
  throw new ProviderError("auth", route.reason ?? "Transcription is not configured.");
}

async function scribe(apiKey: string, audioFile: string, language?: string): Promise<Transcript> {
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("timestamps_granularity", "word");
  form.set("tag_audio_events", "false");
  if (language) form.set("language_code", language === "hi" ? "hin" : "eng");
  form.set("file", new Blob([readFileSync(audioFile)]), "audio.wav");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  const body = await response.text();
  if (!response.ok) throw new ProviderError(classifyStatus(response.status), `ElevenLabs STT ${response.status} ${redact(body, [apiKey])}`);
  const parsed = JSON.parse(body) as { language_code?: string; words?: { text?: string; type?: string; start?: number | null; end?: number | null }[] };
  const words = (parsed.words ?? [])
    .filter((w) => w.type === "word" && typeof w.start === "number" && typeof w.end === "number" && (w.text ?? "").trim())
    .map((w) => ({ text: String(w.text).trim(), startMs: Math.round((w.start as number) * 1000), endMs: Math.round((w.end as number) * 1000) }));
  return { words, language: parsed.language_code ?? language ?? "", via: "elevenlabs", model: "scribe_v2" };
}

function whisperCpp(audioFile: string, language?: string): Transcript {
  const bin = whisperBinary();
  const model = whisperModel();
  if (!bin || !model) throw new ProviderError("auth", "whisper.cpp is not installed.");
  const dir = mkdtempSync(join(tmpdir(), "ss-stt-"));
  try {
    const base = join(dir, "out");
    // -ml 1 with --split-on-word gives one word per segment, with its own start and end.
    const run = spawnSync(bin, ["-m", model, "-f", audioFile, "-ml", "1", "-sow", "-oj", "-of", base, "-l", language === "hi" ? "hi" : language === "en" ? "en" : "auto", "-np"], { timeout: 600_000 });
    if (run.status !== 0) throw new ProviderError("unavailable", `whisper.cpp exited ${run.status}`);
    const json = JSON.parse(readFileSync(`${base}.json`, "utf8")) as { transcription?: { text?: string; offsets?: { from?: number; to?: number } }[]; result?: { language?: string } };
    const words = (json.transcription ?? [])
      .map((seg) => ({ text: String(seg.text ?? "").trim(), startMs: Number(seg.offsets?.from ?? 0), endMs: Number(seg.offsets?.to ?? 0) }))
      .filter((w) => w.text && w.endMs >= w.startMs);
    return { words, language: json.result?.language ?? language ?? "", via: "whisper.cpp", model: model.split("/").pop() ?? "ggml" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
