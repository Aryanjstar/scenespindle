import { createHmac } from "node:crypto";
import { appEnv } from "../config/app";
import { RateLimit } from "./db";

function clientIp(request: Request): string {
  // Behind Vercel or Azure Front Door the platform sets the first hop. Locally there is none.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
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
    return true;
  }
}
