import { loadEnv, redact } from "../../config/env";
import { ProviderError, classifyStatus } from "./errors";
import { geminiJson, type GeminiResult } from "./gemini";

export type PlannerCall = { apiKey?: string; system: string; user: string; loose?: boolean };

export type AzurePlanner = { endpoint: string; key: string; deployment: string };

function hasAzurePlannerSettings(): boolean {
  const env = loadEnv();
  return Boolean(env.azurePlannerEndpoint || env.azurePlannerKey || env.azurePlannerDeployment);
}

/** Return a complete, HTTPS Azure chat deployment configuration, if one is set. */
export function azurePlanner(): AzurePlanner | null {
  const env = loadEnv();
  if (!env.azurePlannerEndpoint || !env.azurePlannerKey || !env.azurePlannerDeployment) return null;
  try {
    const url = new URL(env.azurePlannerEndpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    const deployment = env.azurePlannerDeployment.trim();
    if (!deployment || deployment.length > 128) return null;
    return { endpoint: url.origin, key: env.azurePlannerKey, deployment };
  } catch {
    return null;
  }
}

export function plannerReady(geminiKey = loadEnv().geminiApiKey): boolean {
  return Boolean(hasAzurePlannerSettings() || geminiKey);
}

export function plannerProvider(): "azure_planner" | "gemini" {
  return hasAzurePlannerSettings() ? "azure_planner" : "gemini";
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse((fenced?.[1] ?? text).trim());
  } catch {
    throw new ProviderError("invalid", "The planner returned invalid JSON.");
  }
}

function retryDelay(response: Response, attempt: number): number {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(value * 1000, 30_000) : 1000 * (attempt + 1);
}

async function azureJson(config: AzurePlanner, opts: PlannerCall): Promise<GeminiResult> {
  const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": config.key },
        body: JSON.stringify({
          messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
          response_format: { type: "json_object" },
          max_completion_tokens: 8000,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw new ProviderError("unavailable", "The Azure planner could not be reached.");
    }

    const body = await response.text();
    if (response.ok) {
      let parsed: { choices?: { message?: { content?: string | null } }[] };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        throw new ProviderError("invalid", "The Azure planner returned an unreadable response.");
      }
      const content = parsed.choices?.[0]?.message?.content?.trim();
      if (!content) throw new ProviderError("invalid", "The Azure planner returned an empty response.");
      return { json: parseJson(content), model: config.deployment };
    }

    const kind = classifyStatus(response.status);
    const safeDetail = redact(body, [config.key]).replaceAll(/[\r\n]+/g, " ").slice(0, 180);
    if ((response.status !== 429 && response.status < 500) || attempt === 2) {
      throw new ProviderError(kind, safeDetail || `Azure planner request failed (${response.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }
  throw new ProviderError("unavailable", "The Azure planner did not answer.");
}

/** Azure GPT is preferred when configured; Gemini is used only when Azure is unset. */
export async function modelJson(opts: PlannerCall): Promise<GeminiResult> {
  const azure = azurePlanner();
  if (azure) return azureJson(azure, opts);
  if (hasAzurePlannerSettings()) throw new ProviderError("invalid", "Azure planner settings are incomplete or invalid; correct them or remove them to use Gemini.");
  const apiKey = opts.apiKey || loadEnv().geminiApiKey;
  if (!apiKey) throw new ProviderError("auth", "The planner key is not configured.");
  return geminiJson({ apiKey, system: opts.system, user: opts.user, loose: opts.loose });
}
