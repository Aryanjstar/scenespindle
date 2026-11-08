import { randomUUID } from "node:crypto";
import { ProviderError } from "./errors";
import type { WordTiming } from "./elevenlabs";

/** Azure Speech neural voices. Audio and word times come from the synthesis socket; no SDK. */

export function escapeSsml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

type Boundary = { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string }; Text?: string } };

/** WordBoundary metadata from Azure. Offsets are 100-nanosecond ticks. */
export function wordsFromMetadata(payload: string): WordTiming[] {
  let parsed: { Metadata?: Boundary[] };
  try {
    parsed = JSON.parse(payload) as { Metadata?: Boundary[] };
  } catch {
    return [];
  }
  const words: WordTiming[] = [];
  for (const item of parsed.Metadata ?? []) {
    if (item.Type !== "WordBoundary") continue;
    const text = (item.Data?.text?.Text ?? item.Data?.Text ?? "").trim();
    if (!text) continue;
    const startMs = Math.round((item.Data?.Offset ?? 0) / 10_000);
    const durationMs = Math.max(40, Math.round((item.Data?.Duration ?? 40_0000) / 10_000));
    words.push({ text, startMs, endMs: startMs + durationMs });
  }
  return words;
}

function frame(headers: Record<string, string>, body = ""): string {
  return `${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${body}`;
}

export function splitSpeechFrame(raw: string): { headers: Record<string, string>; body: string } {
  const cut = raw.indexOf("\r\n\r\n");
  const head = cut < 0 ? raw : raw.slice(0, cut);
  const body = cut < 0 ? "" : raw.slice(cut + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function ssml(lang: string, voice: string, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${escapeSsml(text)}</voice></speak>`;
}

async function speakSocket(opts: { key: string; region: string; voice: string; text: string; lang: string }): Promise<{ audio: Buffer; words: WordTiming[] }> {
  const requestId = randomUUID().replaceAll("-", "");
  const spoken = ssml(opts.lang, opts.voice, opts.text);
  const chunks: Buffer[] = [];
  const words: WordTiming[] = [];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve();
    };
    const socket = new WebSocket(`wss://${opts.region}.tts.speech.microsoft.com/cognitiveservices/websocket/v1`, {
      // Node's WebSocket accepts headers. The DOM type does not.
      headers: { "Ocp-Apim-Subscription-Key": opts.key },
    } as unknown as string[]);
    const timer = setTimeout(() => finish(new ProviderError("unavailable", "Azure Speech did not answer in time.")), 30_000);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      const stamp = new Date().toISOString();
      const config = JSON.stringify({ context: { synthesis: { audio: { metadataOptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } });
      socket.send(frame({ Path: "speech.config", "X-RequestId": requestId, "X-Timestamp": stamp, "Content-Type": "application/json" }, config));
      socket.send(frame({ Path: "ssml", "X-RequestId": requestId, "X-Timestamp": new Date().toISOString(), "Content-Type": "application/ssml+xml" }, spoken));
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        const message = splitSpeechFrame(event.data);
        const path = message.headers.path ?? "";
        if (path === "audio.metadata") words.push(...wordsFromMetadata(message.body));
        if (path === "turn.end") finish();
        if (path === "response" && /error|quota|unauthorized|forbidden/i.test(message.body)) {
          finish(new ProviderError(/quota|429/i.test(message.body) ? "quota" : "auth", "Azure Speech rejected the line."));
        }
        return;
      }
      const bytes = Buffer.from(event.data as ArrayBuffer);
      if (bytes.length < 2) return;
      const headerLen = bytes.readUInt16BE(0);
      if (headerLen + 2 > bytes.length) return;
      const header = splitSpeechFrame(bytes.subarray(2, 2 + headerLen).toString("utf8"));
      if ((header.headers.path ?? "") !== "audio") return;
      const audio = bytes.subarray(2 + headerLen);
      if (audio.length) chunks.push(audio);
    };
    socket.onerror = () => finish(new ProviderError("unavailable", "Azure Speech could not be reached."));
    socket.onclose = () => { if (chunks.length) finish(); else finish(new ProviderError("unavailable", "Azure Speech closed before any audio.")); };
  });
  if (!chunks.length) throw new ProviderError("unavailable", "Azure Speech returned no audio.");
  return { audio: Buffer.concat(chunks), words };
}

async function speakRest(opts: { key: string; region: string; voice: string; text: string; lang: string }): Promise<Buffer> {
  const response = await fetch(`https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": opts.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "scenespindle",
    },
    body: ssml(opts.lang, opts.voice, opts.text),
  });
  if (!response.ok) {
    const body = await response.text();
    const quota = response.status === 402 || response.status === 429 || /quota/i.test(body);
    throw new ProviderError(quota ? "quota" : response.status === 401 || response.status === 403 ? "auth" : "unavailable", "Azure Speech could not speak that line.");
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function azureSpeak(opts: { key: string; region: string; voice: string; text: string; lang: string }): Promise<{ audio: Buffer; words: WordTiming[]; model: string }> {
  const region = opts.region || "centralindia";
  try {
    const take = await speakSocket({ ...opts, region });
    return { ...take, model: `azure-speech:${opts.voice}` };
  } catch (error) {
    if (error instanceof ProviderError && (error.kind === "quota" || error.kind === "auth")) throw error;
    const audio = await speakRest({ ...opts, region });
    return { audio, words: [], model: `azure-speech:${opts.voice}` };
  }
}
