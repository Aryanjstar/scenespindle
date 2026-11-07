import { authed, isOwner, json } from "../../../server/guard";
import { loadEnv } from "../../../config/env";
import { monthlyAllowance } from "../../../config/providers";
import { User } from "../../../server/db";
import { creatorUsage, period, usageSummary } from "../../../server/usage";

const PROVIDERS = [
  { id: "gemini", label: "Planner (Gemini)", unit: "calls", key: "geminiApiKey" },
  { id: "elevenlabs", label: "Voice (ElevenLabs)", unit: "characters", key: "elevenLabsApiKey" },
  { id: "sarvam", label: "Voice (Sarvam)", unit: "characters", key: "sarvamApiKey" },
  { id: "images", label: "Pictures (Azure image)", unit: "images", key: "" },
  { id: "stt", label: "Transcription", unit: "seconds", key: "" },
] as const;

/**
 * Usage this month. Every creator sees their own use and any cap the owner set for them; the owner
 * also sees the studio totals. Studio-side ledger only: the provider dashboard is the billing truth.
 */
export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const env = loadEnv() as unknown as Record<string, string | undefined>;
  const owner = isOwner(auth.user);
  const studio = owner ? await usageSummary() : [];
  const mine = await creatorUsage(auth.user!._id);
  const caps = (await User.findById(auth.user!._id).select("allowances").lean<{ allowances?: Record<string, number> }>())?.allowances ?? {};
  const row = (rows: { provider: string; used: number; reserved: number }[], id: string) => rows.find((item) => item.provider === id);
  return json({
    period: period(),
    owner,
    providers: PROVIDERS.map((p) => ({
      id: p.id, label: p.label, unit: p.unit,
      configured: p.key ? Boolean(env[p.key]) : p.id === "images" ? Boolean(process.env.AZURE_IMAGE_ENDPOINT) : true,
      mine: (row(mine, p.id)?.used ?? 0) + (row(mine, p.id)?.reserved ?? 0),
      myLimit: typeof caps[p.id] === "number" ? caps[p.id] : null,
      ...(owner ? { studio: (row(studio, p.id)?.used ?? 0) + (row(studio, p.id)?.reserved ?? 0), studioLimit: monthlyAllowance(p.id as never) } : {}),
    })),
    note: "Studio-side ledger. The provider's own dashboard is the billing source of truth.",
  });
}
