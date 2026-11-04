/**
 * Provider catalog and allowances. Every voice the studio can use is listed here.
 * A voice is selectable only when its adapter is configured; there is no silent
 * fallback from one voice to another.
 */
export type VoiceTiming = "aligned" | "estimated";

export type VoiceEntry = {
  id: string;
  label: string;
  provider: "elevenlabs" | "sarvam" | "test";
  /** Provider-side voice name or speaker id. Resolved inside the adapter. */
  ref: string;
  languages: ("en" | "hi" | "hinglish")[];
  timing: VoiceTiming;
  commercial: boolean;
  note: string;
};

export const VOICES: VoiceEntry[] = [
  {
    id: "elevenlabs:alice",
    label: "Alice",
    provider: "elevenlabs",
    ref: "alice",
    languages: ["en", "hi", "hinglish"],
    timing: "aligned",
    commercial: false,
    note: "ElevenLabs free tier. Word times come from the provider. Free tier is non-commercial.",
  },
  {
    id: "elevenlabs:matilda",
    label: "Matilda",
    provider: "elevenlabs",
    ref: "matilda",
    languages: ["en", "hi", "hinglish"],
    timing: "aligned",
    commercial: false,
    note: "ElevenLabs free tier. Word times come from the provider. Free tier is non-commercial.",
  },
  {
    id: "sarvam:priya",
    label: "Priya (Sarvam)",
    provider: "sarvam",
    ref: "priya",
    languages: ["en", "hi", "hinglish"],
    timing: "estimated",
    commercial: true,
    note: "Sarvam Bulbul. No word timestamps are returned, so caption times are spread over the measured line length and labelled estimated.",
  },
  {
    id: "test:tone",
    label: "Test tone",
    provider: "test",
    ref: "tone",
    languages: ["en", "hi", "hinglish"],
    timing: "estimated",
    commercial: false,
    note: "Local test signal for pipeline checks. Not narration. Enabled only when SCENESPINDLE_TEST_VOICE=1.",
  },
];

export function voiceEntry(id: string): VoiceEntry | undefined {
  return VOICES.find((voice) => voice.id === id);
}

export type ProviderKeys = { elevenLabsApiKey: string; sarvamApiKey: string };

export function testVoiceEnabled(): boolean {
  return process.env.SCENESPINDLE_TEST_VOICE === "1";
}

/** Why a voice cannot be used right now, or null when it can. */
export function voiceUnavailable(entry: VoiceEntry, keys: ProviderKeys, language?: "en" | "hi" | "hinglish"): string | null {
  if (language && !entry.languages.includes(language)) return "This narrator does not speak the project language.";
  if (entry.provider === "elevenlabs" && !keys.elevenLabsApiKey) return "The ElevenLabs key is not configured.";
  if (entry.provider === "sarvam" && !keys.sarvamApiKey) return "The Sarvam key is not configured.";
  if (entry.provider === "test" && !testVoiceEnabled()) return "The test tone is only for pipeline checks.";
  return null;
}

/** Monthly character allowances per provider. Cache hits do not count. */
export function monthlyAllowance(provider: VoiceEntry["provider"] | "gemini" | "images"): number {
  const read = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  if (provider === "elevenlabs") return read("ELEVENLABS_MONTHLY_CHARS", 10_000);
  if (provider === "sarvam") return read("SARVAM_MONTHLY_CHARS", 20_000);
  if (provider === "gemini") return read("GEMINI_MONTHLY_CALLS", 500);
  if (provider === "images") return read("IMAGE_MONTHLY_IMAGES", 300);
  return Number.MAX_SAFE_INTEGER;
}
