import test from "node:test";
import assert from "node:assert/strict";
import { azurePlanner, modelJson, plannerProvider } from "../src/server/providers/planner.js";

const ENV_KEYS = ["AZURE_PLANNER_ENDPOINT", "AZURE_PLANNER_KEY", "AZURE_PLANNER_DEPLOYMENT", "GEMINI_API_KEY"] as const;

async function withPlannerEnv(values: Record<(typeof ENV_KEYS)[number], string>, work: () => Promise<void>) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of ENV_KEYS) process.env[key] = values[key];
    await work();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.fetch = originalFetch;
  }
}

test("planner uses configured Azure chat and parses its JSON response", async () => {
  await withPlannerEnv({
    AZURE_PLANNER_ENDPOINT: "https://studio.openai.azure.com/",
    AZURE_PLANNER_KEY: "azure-test-secret",
    AZURE_PLANNER_DEPLOYMENT: "gpt-test",
    GEMINI_API_KEY: "gemini-fallback-secret",
  }, async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    assert.equal(plannerProvider(), "azure_planner");
    assert.equal(azurePlanner()?.deployment, "gpt-test");
    const result = await modelJson({ apiKey: "gemini-fallback-secret", system: "system", user: "user" });
    assert.deepEqual(result.json, { ok: true });
    assert.equal(result.model, "gpt-test");
    assert.equal(requestUrl, "https://studio.openai.azure.com/openai/deployments/gpt-test/chat/completions?api-version=2024-10-21");
    assert.equal(new Headers(requestInit?.headers).get("api-key"), "azure-test-secret");
    assert.equal(JSON.parse(String(requestInit?.body)).response_format.type, "json_object");
  });
});

test("insecure Azure settings fail explicitly instead of silently using Gemini", async () => {
  await withPlannerEnv({
    AZURE_PLANNER_ENDPOINT: "http://studio.openai.azure.com",
    AZURE_PLANNER_KEY: "azure-test-secret",
    AZURE_PLANNER_DEPLOYMENT: "gpt-test",
    GEMINI_API_KEY: "gemini-test-secret",
  }, async () => {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      assert.match(String(input), /openai\.azure\.com/);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"fallback":true}' }] } }] }), { status: 200 });
    };
    assert.equal(azurePlanner(), null);
    assert.equal(plannerProvider(), "azure_planner");
    await assert.rejects(modelJson({ system: "system", user: "user" }), /Azure planner settings are incomplete or invalid/);
    assert.equal(calls, 0);
  });
});

test("Gemini is selected when Azure planner settings are entirely unset", async () => {
  await withPlannerEnv({
    AZURE_PLANNER_ENDPOINT: "",
    AZURE_PLANNER_KEY: "",
    AZURE_PLANNER_DEPLOYMENT: "",
    GEMINI_API_KEY: "gemini-test-secret",
  }, async () => {
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"fallback":true}' }] } }] }), { status: 200 });
    };
    assert.equal(plannerProvider(), "gemini");
    const result = await modelJson({ system: "system", user: "user" });
    assert.deepEqual(result.json, { fallback: true });
    assert.match(requestUrl, /generativelanguage\.googleapis\.com/);
  });
});
