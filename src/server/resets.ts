import { randomBytes } from "node:crypto";
import { appEnv } from "../config/app";
import { Reset } from "./db";
import { hashToken } from "./session";

export const RESET_TTL_MS = 60 * 60 * 1000;

/** Single-use, one-hour reset link. Only the HMAC of the token is stored. */
export async function createReset(userId: unknown): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await Reset.updateMany({ userId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  await Reset.create({ userId, tokenHash: hashToken(token), expiresAt });
  return { url: `${appEnv().origin}/reset#${token}`, expiresAt };
}
