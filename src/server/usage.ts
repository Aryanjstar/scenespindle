import { monthlyAllowance, type VoiceEntry } from "../config/providers";
import { Usage } from "./db";

export class QuotaError extends Error {
  constructor(public provider: string) {
    super(`The monthly ${provider} allowance is used up.`);
  }
}

export function period(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Reserve provider units before a call. The reservation succeeds only while
 * used + reserved + units stays within the monthly allowance.
 */
export async function reserve(provider: VoiceEntry["provider"] | "gemini" | "images", units: number): Promise<() => Promise<void>> {
  if (provider === "test") return async () => {};
  const limit = monthlyAllowance(provider);
  const key = { provider, period: period() };
  await Usage.updateOne(key, { $setOnInsert: { used: 0, reserved: 0 } }, { upsert: true }).catch(() => {});
  const updated = await Usage.findOneAndUpdate(
    { ...key, $expr: { $lte: [{ $add: ["$used", "$reserved", units] }, limit] } },
    { $inc: { reserved: units } },
    { new: true },
  );
  if (!updated) throw new QuotaError(provider);
  let settled = false;
  /** Settle: the call ran, so move the reservation into used. */
  return async () => {
    if (settled) return;
    settled = true;
    await Usage.updateOne(key, { $inc: { reserved: -units, used: units } });
  };
}

export async function release(provider: string, units: number) {
  await Usage.updateOne({ provider, period: period() }, { $inc: { reserved: -units } });
}

export async function usageSummary() {
  const rows = await Usage.find({ period: period() }).lean<{ provider: string; used: number; reserved: number }[]>();
  return rows.map((row) => ({ provider: row.provider, used: row.used, reserved: row.reserved }));
}
