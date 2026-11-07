import { loadEnv } from "../config/env";
import { VOICES, voiceUnavailable } from "../config/providers";
import { STAGE_ACTIONS, STAGE_SETS, STAGE_SHOTS } from "../compiler/stage";
import { imageConfig } from "./providers/images";
import { sttAvailable } from "./providers/stt";
import { MONTAGE_STYLES } from "../catalog/montage-styles";

/** What this studio can actually do right now. Unavailable options say why. */
export function capabilities() {
  const env = loadEnv();
  const images = Boolean(imageConfig());
  const stt = sttAvailable(env);
  return {
    modes: [
      { id: "explainer", label: "Explainer", available: true, note: "A narrated idea with diagrams and on-screen words." },
      { id: "code_lab", label: "Code Lab", available: true, note: "Your Python or JavaScript runs in your browser; the film shows what really happened." },
      { id: "story", label: "Story", available: true, note: images ? "A 3D cast performs your story, or illustrated stills with camera moves." : "A 3D cast performs your story. Illustrated stills need the image service." },
      { id: "cartoon", label: "Cartoon", available: true, note: "Bright 3D cartoon stage with a recurring cast." },
      { id: "audio", label: "Audio", available: true, note: "Your script read aloud, the words on screen as they are spoken." },
      { id: "lyrics", label: "Lyrics", available: true, note: "Your song with its words on screen, timed from your lyric file." },
      { id: "montage", label: "Montage", available: true, note: "Your photos and clips, cut on the beats of your music, in a style you pick." },
      { id: "reel", label: "Caption a reel", available: true, note: stt.available ? "Your own reel with word-timed captions placed where they do not cover faces or text." : "Your own reel with captions from SRT, LRC or plain lines. Automatic timing needs a transcription key." },
    ],
    story: {
      looks: [
        { id: "stage", label: "3D stage", available: true },
        { id: "illustrated", label: "Illustrated stills", available: images, reason: images ? undefined : "The image service is not configured." },
      ],
      sets: STAGE_SETS, actions: STAGE_ACTIONS, shots: STAGE_SHOTS,
    },
    montageStyles: MONTAGE_STYLES.map((style) => ({ id: style.id, label: style.label, note: style.note })),
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
    captions: { transcription: stt.available, transcriptionVia: stt.via, reason: stt.reason, placement: ["auto", "top", "middle", "bottom"], autoPlacement: Boolean(env.geminiApiKey) },
    research: { available: Boolean(env.geminiApiKey), note: env.geminiApiKey ? "Up to 3 web searches per brief, with sources and dates." : "Needs the planner key." },
    exports: ["mp4", "srt", "vtt", "audio", "package", "otio"],
    execution: [
      { id: "hosted", label: "Studio worker", available: true },
      { id: "paired-agent", label: "My paired PC", available: true, note: "Pair a PC in Settings; it renders with its own keys and tools." },
    ],
    profiles: [
      { id: "2d", label: "2D (HyperFrames)", available: true },
      { id: "realtime-3d", label: "3D stage (Three.js)", available: true },
      { id: "cinematic-3d", label: "Cinematic 3D (Blender)", available: true, note: "Renders only on a paired PC that has Blender installed." },
    ],
    tools: [
      { id: "banner", label: "Banner", available: true, note: "LinkedIn and X banners as PNG, with safe-area checks." },
      { id: "profile-copy", label: "Profile copy", available: Boolean(env.geminiApiKey), note: "Headline, About and bio drafts from facts you give." },
    ],
  };
}
