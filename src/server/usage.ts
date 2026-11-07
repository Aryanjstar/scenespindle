import { monthlyAllowance, type VoiceEntry } from "../config/providers";
import { Usage, User } from "./db";

export type Provider = VoiceEntry["provider"] | "gemini" | "images" | "stt";

export class QuotaError extends Error {
  constructor(public provider: string, public scope: "studio" | "creator" = "studio") {
    super(scope === "creator" ? `Your monthly ${provider} allowance is used up. Ask the studio owner to raise it.` : `The monthly ${provider} allowance is used up.`);
  }
}

export function period(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Per-creator rows share the collection; their period key carries the creator id. */
function creatorKey(provider: string, ownerId: unknown) {
  return { provider, period: `${period()}:${String(ownerId)}` };
}

async function hold(key: { provider: string; period: string }, units: number, limit: number): Promise<boolean> {
  await Usage.updateOne(key, { $setOnInsert: { used: 0, reserved: 0 } }, { upsert: true }).catch(() => {});
  const updated = await Usage.findOneAndUpdate(
    { ...key, $expr: { $lte: [{ $add: ["$used", "$reserved", units] }, limit] } },
    { $inc: { reserved: units } },
    { new: true },
  );
  return Boolean(updated);
}

/** The creator's own monthly cap, if the owner set one. Unset means only the studio cap applies. */
export async function creatorAllowance(ownerId: unknown, provider: string): Promise<number | null> {
  if (!ownerId) return null;
  const user = await User.findById(ownerId).select("allowances").lean<{ allowances?: Record<string, number> }>();
  const value = user?.allowances?.[provider];
  return typeof value === "number" && value >= 0 ? value : null;
}

export type Meter = { settle: () => Promise<void>; release: () => Promise<void> };

/**
 * Reserve provider units before a call. Settle after the call succeeds; release if it fails,
 * so failed calls never count against the allowance. Holds both the studio cap and, when the
 * owner set one, the creator's cap.
 */
export async function meter(provider: Provider, units: number, ownerId?: unknown): Promise<Meter> {
  if (provider === "test" || units <= 0) return { settle: async () => {}, release: async () => {} };
  const studio = { provider, period: period() };
  if (!(await hold(studio, units, monthlyAllowance(provider as never)))) throw new QuotaError(provider);
  const cap = await creatorAllowance(ownerId, provider);
  const creator = cap === null ? null : creatorKey(provider, ownerId);
  if (creator && !(await hold(creator, units, cap!))) {
    await Usage.updateOne(studio, { $inc: { reserved: -units } });
    throw new QuotaError(provider, "creator");
  }
  let done = false;
  const finish = async (used: boolean) => {
    if (done) return;
    done = true;
    const change = used ? { reserved: -units, used: units } : { reserved: -units };
    await Usage.updateOne(studio, { $inc: change });
    if (creator) await Usage.updateOne(creator, { $inc: change });
  };
  return { settle: () => finish(true), release: () => finish(false) };
}

/** Back-compatible: reserve and return a settle function. Prefer `meter`. */
export async function reserve(provider: Provider, units: number, ownerId?: unknown): Promise<() => Promise<void>> {
  const m = await meter(provider, units, ownerId);
  return m.settle;
}

/** Studio-wide totals (owner view). */
export async function usageSummary() {
  const rows = await Usage.find({ period: period() }).lean<{ provider: string; used: number; reserved: number }[]>();
  return rows.map((row) => ({ provider: row.provider, used: row.used, reserved: row.reserved, limit: monthlyAllowance(row.provider as never) }));
}

/** One creator's own usage this month. */
export async function creatorUsage(ownerId: unknown) {
  const rows = await Usage.find({ period: `${period()}:${String(ownerId)}` }).lean<{ provider: string; used: number; reserved: number }[]>();
  return rows.map((row) => ({ provider: row.provider, used: row.used, reserved: row.reserved }));
}
