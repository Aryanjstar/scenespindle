import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Env = {
  geminiApiKey: string;
  sarvamApiKey: string;
  elevenLabsApiKey: string;
  azureSpeechKey: string;
  azureSpeechRegion: string;
};

function parseFile(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    let value = trimmed.slice(i + 1).trim();
    // Quoted values keep everything inside the quotes; unquoted values drop an inline " # comment".
    const quoted = value.match(/^(["'])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "").trim();
    map.set(trimmed.slice(0, i).trim(), value);
  }
  return map;
}

export function loadEnv(root = process.cwd()): Env {
  const map = parseFile(resolve(root, ".env.local"));
  const pick = (key: string) => process.env[key] ?? map.get(key) ?? "";
  return {
    geminiApiKey: pick("GEMINI_API_KEY"),
    sarvamApiKey: pick("SARVAM_API_KEY"),
    elevenLabsApiKey: pick("ELEVENLABS_API_KEY"),
    azureSpeechKey: pick("AZURE_SPEECH_KEY"),
    azureSpeechRegion: pick("AZURE_SPEECH_REGION") || "eastus2",
  };
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 6) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 280);
}
