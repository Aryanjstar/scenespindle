/**
 * Provider catalog and allowances. Every voice the studio can use is listed here.
 * A voice is selectable only when its adapter is configured. If the chosen voice
 * is out of credits, the render may use another configured voice for the whole
 * film and the job says who spoke.
 */
export type VoiceTiming = "aligned" | "estimated";
export type VoiceLanguage = "en" | "hi" | "hinglish";

export type VoiceEntry = {
  id: string;
  label: string;
  provider: "azure" | "sarvam" | "elevenlabs" | "test";
  /** Provider-side voice name or speaker id. Resolved inside the adapter. */
  ref: string;
  gender: "female" | "male";
  languages: VoiceLanguage[];
  timing: VoiceTiming;
  commercial: boolean;
  note: string;
};

/** House narrator for new projects: Indian English, female, on Azure Speech. */
export const DEFAULT_VOICE_ID = "azure:neerja";

export const VOICES: VoiceEntry[] = [
  {
    id: "azure:neerja",
    label: "Neerja",
    provider: "azure",
    ref: "en-IN-NeerjaNeural",
    gender: "female",
    languages: ["en", "hinglish"],
    timing: "aligned",
    commercial: true,
    note: "Azure Speech, Indian English, female. Word times come from Azure.",
  },
  {
    id: "azure:prabhat",
    label: "Prabhat",
    provider: "azure",
    ref: "en-IN-PrabhatNeural",
    gender: "male",
    languages: ["en", "hinglish"],
    timing: "aligned",
    commercial: true,
    note: "Azure Speech, Indian English, male. Word times come from Azure.",
  },
  {
    id: "azure:swara",
    label: "Swara",
    provider: "azure",
    ref: "hi-IN-SwaraNeural",
    gender: "female",
    languages: ["hi", "hinglish"],
    timing: "aligned",
    commercial: true,
    note: "Azure Speech, Hindi, female. Word times come from Azure.",
  },
  {
    id: "azure:madhur",
    label: "Madhur",
    provider: "azure",
    ref: "hi-IN-MadhurNeural",
    gender: "male",
    languages: ["hi", "hinglish"],
    timing: "aligned",
    commercial: true,
    note: "Azure Speech, Hindi, male. Word times come from Azure.",
  },
  {
    id: "elevenlabs:alice",
    label: "Alice",
    provider: "elevenlabs",
    ref: "alice",
    gender: "female",
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
    gender: "female",
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
    gender: "female",
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
    gender: "female",
    languages: ["en", "hi", "hinglish"],
    timing: "estimated",
    commercial: false,
    note: "Local test signal for pipeline checks. Not narration. Enabled only when SCENESPINDLE_TEST_VOICE=1.",
  },
];

export function voiceEntry(id: string): VoiceEntry | undefined {
  return VOICES.find((voice) => voice.id === id);
}

export type ProviderKeys = {
  elevenLabsApiKey: string;
  sarvamApiKey: string;
  azureSpeechKey?: string;
  azureSpeechRegion?: string;
};

const PROVIDER_RANK: Record<VoiceEntry["provider"], number> = { azure: 0, sarvam: 1, elevenlabs: 2, test: 3 };

/**
 * Voices that can read this film. The chosen voice is first when it is configured.
 * The rest prefer the same gender, then Azure, then Sarvam, then ElevenLabs.
 * The test tone is only included when it is the voice that was chosen.
 */
export function voiceCandidates(chosenId: string, language: VoiceLanguage, keys: ProviderKeys): VoiceEntry[] {
  const chosen = voiceEntry(chosenId);
  const usable = (voice: VoiceEntry) => {
    if (!voice.languages.includes(language)) return false;
    if (voiceUnavailable(voice, keys, language)) return false;
    if (voice.provider === "test" && voice.id !== chosen?.id) return false;
    return true;
  };
  const rest = VOICES.filter((voice) => voice.id !== chosen?.id && usable(voice));
  rest.sort((a, b) => {
    const gender = (voice: VoiceEntry) => (chosen && voice.gender === chosen.gender ? 0 : 1);
    return gender(a) - gender(b) || PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] || a.id.localeCompare(b.id);
  });
  return chosen && usable(chosen) ? [chosen, ...rest] : rest;
}

export function voiceSwitchNotice(chosen: VoiceEntry, used: VoiceEntry): string | undefined {
  if (chosen.id === used.id) return undefined;
  return `${chosen.label} had no credits left, so ${used.label} read this.`;
}

export function testVoiceEnabled(): boolean {
  return process.env.SCENESPINDLE_TEST_VOICE === "1";
}

/** Why a voice cannot be used right now, or null when it can. */
export function voiceUnavailable(entry: VoiceEntry, keys: ProviderKeys, language?: "en" | "hi" | "hinglish"): string | null {
  if (language && !entry.languages.includes(language)) return "This narrator does not speak the project language.";
  if (entry.provider === "azure" && !keys.azureSpeechKey) return "The Azure Speech key is not configured.";
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
  if (provider === "azure") return read("AZURE_SPEECH_MONTHLY_CHARS", 500_000);
  if (provider === "elevenlabs") return read("ELEVENLABS_MONTHLY_CHARS", 10_000);
  if (provider === "sarvam") return read("SARVAM_MONTHLY_CHARS", 20_000);
  if (provider === "gemini") return read("GEMINI_MONTHLY_CALLS", 500);
  if (provider === "images") return read("IMAGE_MONTHLY_IMAGES", 300);
  return Number.MAX_SAFE_INTEGER;
}
