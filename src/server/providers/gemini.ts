import { redact } from "../../config/env";
import { ProviderError, classifyStatus } from "./errors";

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-flash-lite-latest"];

export type GeminiResult = { json: unknown; model: string };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          purpose: { type: "string", enum: ["hook", "setup", "explain", "example", "recap", "cta"] },
          narration: { type: "string" },
          kicker: { type: "string" },
          title: { type: "string" },
          slam: { type: "string" },
          handwritten: { type: "string" },
          visual: {
            type: "string",
            enum: ["none", "lattu-still", "lattu-spin", "orbit-pull", "orbit-side", "orbit-both", "compare", "bullets"],
          },
          left: { type: "string" },
          right: { type: "string" },
          leftLabel: { type: "string" },
          rightLabel: { type: "string" },
          bullets: { type: "string" },
        },
        required: [
          "purpose",
          "narration",
          "kicker",
          "title",
          "slam",
          "handwritten",
          "visual",
          "left",
          "right",
          "leftLabel",
          "rightLabel",
          "bullets",
        ],
      },
    },
  },
  required: ["title", "logline", "scenes"],
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

async function callModel(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: boolean;
}): Promise<{ ok: true; json: unknown } | { ok: false; status: number; detail: string }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
        ...(opts.schema ? { responseSchema: RESPONSE_SCHEMA } : {}),
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) return { ok: false, status: response.status, detail: redact(body, [opts.apiKey]) };
  const parsed = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text) return { ok: false, status: 422, detail: "empty plan" };
  return { ok: true, json: extractJson(text) };
}

export async function geminiJson(opts: {
  apiKey: string;
  system: string;
  user: string;
  loose?: boolean;
}): Promise<GeminiResult> {
  let lastError = "No model attempted";
  for (let round = 0; round < 3; round++) {
    for (const model of MODELS) {
      try {
        let result = await callModel({ ...opts, model, schema: opts.loose ? false : true });
        if (!result.ok && result.status === 400 && !opts.loose) result = await callModel({ ...opts, model, schema: false });
        if (result.ok) return { json: result.json, model };
        lastError = `${model} ${result.status} ${result.detail}`;
        if (result.status !== 503 && result.status !== 429 && result.status !== 404) {
          throw new ProviderError(classifyStatus(result.status), lastError);
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        lastError = error instanceof Error ? error.message : "network";
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (round + 1)));
  }
  throw new ProviderError("unavailable", lastError);
}

export type GroundedSource = { url: string; title: string };
export type GroundedResult = { text: string; sources: GroundedSource[]; queries: string[]; model: string };

/**
 * Bounded web research through Gemini's Google Search tool. The answer is plain text plus the
 * sources the model actually grounded on. Page content is data for the brief, never instructions.
 */
export async function geminiGrounded(opts: { apiKey: string; system: string; user: string }): Promise<GroundedResult> {
  let lastError = "No model attempted";
  for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      }),
    }).catch((error: unknown) => ({ ok: false, status: 0, text: async () => (error instanceof Error ? error.message : "network") }) as unknown as Response);
    const body = await response.text();
    if (!response.ok) {
      lastError = `${model} ${response.status} ${redact(body, [opts.apiKey])}`;
      if (response.status === 401 || response.status === 403 || response.status === 400) throw new ProviderError(classifyStatus(response.status), lastError);
      continue;
    }
    const parsed = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[] };
    const candidate = parsed.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => ({ url: String(chunk.web?.uri ?? ""), title: String(chunk.web?.title ?? "").slice(0, 160) }))
      .filter((source) => /^https:\/\//.test(source.url))
      .slice(0, 5);
    return { text: text.slice(0, 4000), sources, queries: (candidate?.groundingMetadata?.webSearchQueries ?? []).slice(0, 3).map((q) => String(q).slice(0, 200)), model };
  }
  throw new ProviderError("unavailable", lastError);
}

/** One JSON answer about a few images (contact-sheet frames). Images are JPEG bytes. */
export async function geminiVisionJson(opts: { apiKey: string; system: string; user: string; images: Buffer[] }): Promise<GeminiResult> {
  let lastError = "No model attempted";
  for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [...opts.images.slice(0, 8).map((data) => ({ inlineData: { mimeType: "image/jpeg", data: data.toString("base64") } })), { text: opts.user }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      lastError = `${model} ${response.status} ${redact(body, [opts.apiKey])}`;
      if (response.status === 401 || response.status === 403 || response.status === 400) throw new ProviderError(classifyStatus(response.status), lastError);
      continue;
    }
    const parsed = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    try { return { json: extractJson(text), model }; } catch { lastError = `${model} unparseable`; }
  }
  throw new ProviderError("unavailable", lastError);
}
