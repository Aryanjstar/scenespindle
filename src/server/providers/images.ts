import { redact } from "../../config/env";
import { ProviderError, classifyStatus } from "./errors";

/**
 * Image generation through an Azure OpenAI image deployment (gpt-image family).
 * Prompts are data written by the planner or the creator. Results are PNG bytes
 * that the caller stores as owner-scoped assets with provenance.
 */
export type ImageConfig = { endpoint: string; key: string; deployment: string };

export function imageConfig(): ImageConfig | null {
  const endpoint = process.env.AZURE_IMAGE_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_IMAGE_KEY;
  if (!endpoint || !key) return null;
  return { endpoint, key, deployment: process.env.AZURE_IMAGE_DEPLOYMENT || "gpt-image" };
}

const API = "api-version=2025-04-01-preview";

export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";

export function sizeFor(format: string): ImageSize {
  return format === "16x9" ? "1536x1024" : format === "1x1" ? "1024x1024" : "1024x1536";
}

async function parse(response: Response, key: string): Promise<Buffer> {
  const text = await response.text();
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after")) * 1000 || undefined;
    throw new ProviderError(classifyStatus(response.status), `image ${response.status} ${redact(text, [key])}`, retry);
  }
  const body = JSON.parse(text) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("invalid", "The image service returned no image.");
  return Buffer.from(b64, "base64");
}

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await work();
    } catch (error) {
      last = error;
      if (!(error instanceof ProviderError) || (error.kind !== "rate_limited" && error.kind !== "unavailable")) throw error;
      await new Promise((done) => setTimeout(done, error.retryAfterMs ?? 15_000 * (attempt + 1)));
    }
  }
  throw last;
}

/** Text to image. */
export async function generateImage(cfg: ImageConfig, prompt: string, size: ImageSize, quality: "low" | "medium" | "high" = "medium"): Promise<Buffer> {
  return withRetry(async () => parse(await fetch(`${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/generations?${API}`, {
    method: "POST",
    headers: { "api-key": cfg.key, "content-type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 3800), size, quality, n: 1 }),
    signal: AbortSignal.timeout(240_000),
  }), cfg.key));
}

/** Image guided by one or more reference images (character sheets). Keeps faces, outfits and style consistent. */
export async function editImage(cfg: ImageConfig, prompt: string, references: Buffer[], size: ImageSize, quality: "low" | "medium" | "high" = "medium"): Promise<Buffer> {
  return withRetry(async () => {
    const form = new FormData();
    form.set("prompt", prompt.slice(0, 3800));
    form.set("size", size);
    form.set("quality", quality);
    form.set("n", "1");
    references.slice(0, 4).forEach((data, index) => form.append("image[]", new Blob([new Uint8Array(data)], { type: "image/png" }), `ref-${index}.png`));
    return parse(await fetch(`${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/edits?${API}`, {
      method: "POST",
      headers: { "api-key": cfg.key },
      body: form,
      signal: AbortSignal.timeout(300_000),
    }), cfg.key);
  });
}
