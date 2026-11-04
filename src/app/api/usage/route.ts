import { authed, json } from "../../../server/guard";
import { loadEnv } from "../../../config/env";
import { monthlyAllowance } from "../../../config/providers";
import { period, usageSummary } from "../../../server/usage";

export async function GET() {
  const auth = await authed();
  if ("error" in auth && auth.error) return auth.error;
  const env = loadEnv();
  const rows = await usageSummary();
  const used = (provider: string) => {
    const row = rows.find((item) => item.provider === provider);
    return (row?.used ?? 0) + (row?.reserved ?? 0);
  };
  // Narration is metered by the studio's own ledger. The planner is not metered yet.
  return json({
    period: period(),
    providers: [
      { id: "gemini", label: "Planner (Gemini)", configured: Boolean(env.geminiApiKey), used: null, limit: null },
      { id: "elevenlabs", label: "Voice (ElevenLabs)", configured: Boolean(env.elevenLabsApiKey), used: used("elevenlabs"), limit: monthlyAllowance("elevenlabs") },
      { id: "sarvam", label: "Voice (Sarvam)", configured: Boolean(env.sarvamApiKey), used: used("sarvam"), limit: monthlyAllowance("sarvam") },
    ],
    measured: true,
    note: "Studio-side ledger of characters sent. The provider's own dashboard is the billing source of truth.",
  });
}
