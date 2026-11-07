import { createHmac } from "node:crypto";
import { appEnv } from "../config/app";
import { RateLimit } from "./db";

/**
 * The client address as seen by our own proxy. X-Forwarded-For is a list the client can prefill,
 * so only the entries appended by trusted proxies count: with TRUST_PROXY_HOPS=1 (Azure Container
 * Apps ingress) that is the rightmost entry. With 0 (local), forwarded headers are ignored.
 */
export function clientIp(request: Request, hops = Number(process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === "production" ? 1 : 0))): string {
  if (!Number.isInteger(hops) || hops <= 0) return "local";
  const chain = (request.headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain[chain.length - hops] ?? "unknown";
}

function hashed(value: string): string {
  return createHmac("sha256", appEnv().pepper || "scenespindle-rate").update(value).digest("hex").slice(0, 32);
}

/**
 * Fixed-window limiter stored in MongoDB with a TTL index. Returns false when the
 * caller is over the limit. Identity parts are hashed; raw IPs and emails are never stored.
 */
export async function limit(request: Request, bucket: string, max: number, windowMs: number, extra = ""): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const key = `${bucket}:${window}:${hashed(`${clientIp(request)}|${extra.toLowerCase()}`)}`;
  try {
    const row = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs + 60_000) } },
      { upsert: true, new: true },
    );
    return row.count <= max;
  } catch {
    // A limiter outage must not lock creators out; the request still needs valid credentials.
    console.error("rate-limit-unavailable", bucket);
    return true;
  }
}
