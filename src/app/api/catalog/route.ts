import { json } from "../../../server/guard";
import { loadEnv } from "../../../config/env";
import { VOICES, voiceUnavailable } from "../../../config/providers";

/** Only implemented and configured combinations are available; the rest say why. */
export async function GET() {
  const env = loadEnv();
  return json({
    modes: [
      { id: "explainer", label: "Explainer", available: true },
      { id: "code_lab", label: "Code Lab", available: true, note: "Traces run in your browser. Films use the explainer renderer." },
      { id: "story", label: "Story", available: true, note: "A 3D cast performs the beats. Head, mouth and body move with the narration." },
      { id: "audio", label: "Audio", available: true, note: "Your script, read aloud, with the words on screen as they are spoken." },
      { id: "cartoon", label: "Cartoon", available: true, note: "The same 3D stage, drawn brighter, with a recurring cast." },
      { id: "lyrics", label: "Lyrics", available: true, note: "Your song with its words on screen, timed from your lyric file." },
      { id: "montage", label: "Montage", available: true, note: "Your photos and clips, cut on the beats of your music." },
    ],
    formats: [
      { id: "9x16", label: "Vertical 9:16", available: true },
      { id: "16x9", label: "Landscape 16:9", available: true },
      { id: "1x1", label: "Square 1:1", available: true },
    ],
    languages: [
      { id: "en", label: "English", available: true },
      { id: "hi", label: "Hindi", available: true },
      { id: "hinglish", label: "Hinglish", available: true },
    ],
    voices: VOICES.filter((voice) => voice.provider !== "test" || !voiceUnavailable(voice, env)).map((voice) => {
      const reason = voiceUnavailable(voice, env);
      return { id: voice.id, label: voice.label, provider: voice.provider, languages: voice.languages, timing: voice.timing, commercial: voice.commercial, note: voice.note, available: !reason, reason: reason ?? undefined };
    }),
    lengths: [15000, 30000, 45000, 60000, 90000, 120000, 180000],
    styles: [{ id: "chalk-and-chai@1", label: "Chalk and Chai", available: true }],
  });
}
