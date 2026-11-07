import { redact } from "../../config/env";
import { ProviderError, classifyStatus } from "./errors";

export type VoiceChoice = { id: string; name: string; gender: string };

export type WordTiming = { text: string; startMs: number; endMs: number };

type Alignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
};

export async function listVoices(apiKey: string): Promise<VoiceChoice[]> {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ProviderError(classifyStatus(response.status), `ElevenLabs voices ${response.status} ${redact(body, [apiKey])}`);
  }
  const parsed = JSON.parse(body) as { voices?: { voice_id: string; name: string; labels?: { gender?: string } }[] };
  return (parsed.voices ?? []).map((voice) => ({
    id: voice.voice_id,
    name: voice.name,
    gender: voice.labels?.gender ?? "",
  }));
}

export function pickVoice(voices: VoiceChoice[]): VoiceChoice {
  const wanted = ["alice", "matilda", "lily", "sarah", "jessica"];
  for (const name of wanted) {
    const hit = voices.find((voice) => voice.name.toLowerCase().startsWith(name));
    if (hit) return hit;
  }
  const female = voices.find((voice) => voice.gender.toLowerCase() === "female");
  if (female) return female;
  if (voices[0]) return voices[0];
  throw new ProviderError("unavailable", "ElevenLabs returned no voices");
}

export function wordsFromAlignment(alignment: Alignment | undefined): WordTiming[] {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words: WordTiming[] = [];
  let buf = "";
  let start = 0;
  let end = 0;
  let open = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    if (ch.trim() === "") {
      if (buf) words.push({ text: buf, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
      buf = "";
      open = false;
      continue;
    }
    if (!open) {
      start = starts[i] ?? end;
      open = true;
    }
    end = ends[i] ?? end;
    buf += ch;
  }
  if (buf) words.push({ text: buf, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
  return words;
}

export async function synthesize(opts: {
  apiKey: string;
  voiceId: string;
  text: string;
}): Promise<{ audio: Buffer; words: WordTiming[]; model: string }> {
  const model = "eleven_multilingual_v2";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/with-timestamps`, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ProviderError(/quota_exceeded/i.test(body) ? "quota" : classifyStatus(response.status), `ElevenLabs tts ${response.status} ${redact(body, [opts.apiKey])}`);
  }
  const parsed = JSON.parse(body) as {
    audio_base64?: string;
    alignment?: Alignment;
    normalized_alignment?: Alignment;
  };
  if (!parsed.audio_base64) throw new ProviderError("invalid", "ElevenLabs returned no audio");
  const words = wordsFromAlignment(parsed.alignment);
  const normalized = words.length ? words : wordsFromAlignment(parsed.normalized_alignment);
  if (normalized.length === 0) throw new ProviderError("invalid", "ElevenLabs returned no word timings");
  return { audio: Buffer.from(parsed.audio_base64, "base64"), words: normalized, model };
}
