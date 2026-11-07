import { createHmac, timingSafeEqual } from "node:crypto";
import { appEnv } from "../config/app";

/**
 * Short-lived signed URLs for private files inside sandboxed previews. A sandboxed iframe has an
 * opaque origin, so the browser does not send the session cookie; the signature stands in for it.
 * The signature binds the asset id and expiry and is checked with a constant-time compare.
 */
/** Scope "preview" opens images only; scope "agent" opens any media kind for a paired PC's job. */
export type SignScope = "preview" | "agent";

function mac(id: string, exp: number, scope: SignScope): string {
  const key = appEnv().pepper || "scenespindle-dev-signing";
  return createHmac("sha256", key).update(`asset:${scope}:${id}:${exp}`).digest("base64url").slice(0, 32);
}

export function signAssetUrl(id: string, ttlSeconds = 3600, scope: SignScope = "preview"): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/assets/${id}/file?exp=${exp}&scope=${scope}&sig=${mac(id, exp, scope)}`;
}

export function verifyAssetSignature(id: string, exp: string | null, sig: string | null, scope: string | null = "preview"): SignScope | null {
  const s: SignScope = scope === "agent" ? "agent" : "preview";
  if (!exp || !sig || !/^\d{10}$/.test(exp)) return null;
  const when = Number(exp);
  if (when < Date.now() / 1000) return null;
  const expected = Buffer.from(mac(id, when, s));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? s : null;
}

/** Rewrites owner-checked still URLs in a preview document to signed ones, at serve time. */
export function signPreviewImages(html: string): string {
  return html.replaceAll(/\/api\/assets\/([a-f0-9]{24})\/file(?![?\w])/g, (_m, id: string) => signAssetUrl(id));
}

export const PREVIEW_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self' data:; frame-ancestors 'self'";
