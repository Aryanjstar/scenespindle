import { createHash } from "node:crypto";
import { authed } from "../../../../../../server/guard";
import { apiError } from "../../../../../../server/http";
import { loadEnv } from "../../../../../../config/env";
import { voiceEntry, voiceUnavailable } from "../../../../../../config/providers";
import { speak } from "../../../../../../server/providers/voice";
import { hasFile, putBuffer, serveFile } from "../../../../../../server/storage";
import { meter } from "../../../../../../server/usage";
import { limit } from "../../../../../../server/rate-limit";

const SAMPLE: Record<string, string> = {
  en: "Hi, I can narrate your film. Here is how I sound.",
  hi: "नमस्ते, मैं आपकी फ़िल्म सुना सकती हूँ। मेरी आवाज़ ऐसी है।",
  hinglish: "Hi, main aapki film narrate kar sakti hoon. Meri awaaz aisi hai.",
};

/** A short sample of a narrator. Recorded once per voice and language, then served from storage. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const { id } = await ctx.params;
  const voice = voiceEntry(decodeURIComponent(id));
  if (!voice) return apiError(404, "NOT_FOUND", "NOT_FOUND", "That narrator is not here.");
  const lang = new URL(request.url).searchParams.get("language");
  const language = lang === "hi" || lang === "hinglish" ? lang : "en";
  const env = loadEnv();
  const blocked = voiceUnavailable(voice, env, language);
  if (blocked) return apiError(422, "VALIDATION", "CAPABILITY_UNAVAILABLE", blocked);
  const key = `voice-samples/${createHash("sha256").update(`${voice.id}|${voice.ref}|${language}`).digest("hex").slice(0, 32)}`;
  for (const ext of ["mp3", "wav"]) if (await hasFile(`${key}.${ext}`)) return serveFile(`${key}.${ext}`, request);
  if (!(await limit(request, "voice-sample", 20, 60 * 60_000, String(auth.user!._id)))) return apiError(429, "RATE_LIMITED", "RATE_LIMITED", "Too many samples this hour.");
  const text = SAMPLE[language];
  const usage = await meter(voice.provider, text.length, auth.user!._id);
  try {
    const take = await speak(voice, text, env, language);
    await usage.settle();
    await putBuffer(`${key}.${take.ext}`, take.audio);
    return serveFile(`${key}.${take.ext}`, request);
  } catch {
    await usage.release();
    return apiError(503, "UNAVAILABLE", "VOICE_UNAVAILABLE", "The narrator could not record a sample right now.");
  }
}
