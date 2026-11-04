/**
 * `studio remote ...`: drive a running studio over its HTTP API with a personal token.
 * Every command here calls the same endpoint the web UI calls, so work done in the
 * CLI or an AI IDE appears in the studio, and work done in the studio is visible here.
 *
 * Config: STUDIO_URL (e.g. http://localhost:3000) and STUDIO_TOKEN (Settings → API tokens).
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

type Args = { positional: string[]; flags: Record<string, string | true> };

function parse(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[item.slice(2)] = true;
      else { flags[item.slice(2)] = next; i += 1; }
    } else positional.push(item);
  }
  return { positional, flags };
}

export class RemoteError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}: ${(body as { error?: { message?: string } })?.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  }
}

export function client(url = process.env.STUDIO_URL, token = process.env.STUDIO_TOKEN) {
  if (!url) throw new Error("Set STUDIO_URL to the studio address, for example http://localhost:3000");
  if (!token) throw new Error("Set STUDIO_TOKEN to a personal API token from Settings → API tokens");
  const base = url.replace(/\/$/, "");
  async function call(method: string, path: string, body?: unknown, raw = false): Promise<any> {
    const isForm = body instanceof FormData;
    const response = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "follow",
    });
    if (raw) {
      if (!response.ok) throw new RemoteError(response.status, await response.json().catch(() => ({})));
      return response;
    }
    const text = await response.text();
    const parsed = text ? (() => { try { return JSON.parse(text); } catch { return { text }; } })() : {};
    if (!response.ok) throw new RemoteError(response.status, parsed);
    return parsed;
  }
  return { base, call, get: (p: string) => call("GET", p), post: (p: string, b: unknown = {}) => call("POST", p, b), patch: (p: string, b: unknown) => call("PATCH", p, b), del: (p: string) => call("DELETE", p) };
}

type Client = ReturnType<typeof client>;

async function waitJob(api: Client, jobId: string, quiet = false) {
  for (let i = 0; i < 1800; i++) {
    const job = await api.get(`/api/jobs/${jobId}`);
    if (!quiet) process.stderr.write(`job ${job.state} ${(job.stages ?? []).map((s: { name: string; state: string }) => `${s.name}:${s.state}`).join(" ")}\n`);
    if (["succeeded", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error("Timed out waiting for the job");
}

async function draft(api: Client, id: string) {
  return api.get(`/api/projects/${id}/draft`);
}

const list = (value: string | true | undefined) => (typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined);
const str = (value: string | true | undefined) => (typeof value === "string" ? value : undefined);

export const HELP = `studio remote <command>   (needs STUDIO_URL and STUDIO_TOKEN)
  whoami | catalog | usage
  projects [--deleted] | project <id> | create --mode <explainer|code_lab|audio|story|cartoon|lyrics|montage> --topic "..." [--title]
  set <id> [--title] [--format 9x16|16x9|1x1] [--language en|hi|hinglish] [--seconds N] [--voice id] [--cast id,id]
  delete <id> | restore <id>
  idea <id> [--topic] [--audience]
  brief <id> refine --request "..." [--script file] [--audience] | brief <id> answer --choice clear|story|visual | brief <id> approve | brief <id>
  plan <id> | storyboard <id> [--out file] | storyboard-put <id> <plan.json>
  trace <id> <code.py> --entry fn --input '[args]'
  stills <id> [--scenes s1,s2] [--redraw] [--wait]
  approve <id> [--output mp4|preview] [--wait]
  job <jobId> [--wait] | cancel <jobId> | retry <jobId> [--wait]
  videos <id> | download <videoId> [--kind mp4|thumb|sheet|srt|vtt] [--out file]
  share <videoId> [--allow-download] | unshare <videoId>
  copilot <id> "request" [--scenes s1,s2] [--keep] | keep <messageId> | discard <messageId> | messages <id>
  upload <file> | assets
  montage <id> --clips assetId,assetId [--music assetId] [--seconds 15] [--wait]
  lyrics <id> --song assetId --lrc file.lrc
  characters | character <id> | character-create --name N [--image file] [--style storybook|cartoon|flat|clay] [--description "..."] [--wait] | character-draw <id> [--wait]
  series | series-get <id> | series-create --title T [--mode story|cartoon] [--style ...] [--world "..."] [--tone "..."] [--rules a;b] [--cast id,id]
  series-set <id> [--title] [--world] [--tone] [--rules a;b] [--cast id,id] | series-approve <id> | episode <seriesId> --topic "..."
  invites | invite --email E | revoke-invite <id> | reset-link --email E | tokens | token-create --name N [--days 90] | token-revoke <id>
  api <METHOD> <path> [--data json|@file.json]   (any endpoint)`;

export async function remote(argv: string[]): Promise<unknown> {
  const { positional, flags } = parse(argv);
  const [command, ...rest] = positional;
  if (!command || command === "help") return { help: HELP };
  const api = client(str(flags.url), str(flags.token));
  const wait = Boolean(flags.wait);
  const id = rest[0];
  switch (command) {
    case "whoami": return api.get("/api/auth/session");
    case "catalog": return api.get("/api/catalog");
    case "usage": return api.get("/api/usage");
    case "projects": return api.get(`/api/projects${flags.deleted ? "?deleted=1" : ""}`);
    case "project": return api.get(`/api/projects/${id}`);
    case "create": return api.post("/api/projects", { mode: str(flags.mode) ?? "explainer", topic: str(flags.topic) ?? "", title: str(flags.title) ?? (str(flags.topic) ?? "Untitled").slice(0, 80) });
    case "set": {
      const body: Record<string, unknown> = {};
      if (str(flags.title)) body.title = flags.title;
      if (str(flags.format)) body.format = flags.format;
      if (str(flags.language)) body.language = flags.language;
      if (str(flags.seconds)) body.targetMs = Number(flags.seconds) * 1000;
      if (str(flags.voice)) body.voiceId = flags.voice;
      if (flags.cast !== undefined) body.castIds = list(flags.cast) ?? [];
      return api.patch(`/api/projects/${id}`, body);
    }
    case "delete": await api.del(`/api/projects/${id}`); return { deleted: id };
    case "restore": return api.post(`/api/projects/${id}/restore`);
    case "idea": {
      const current = await draft(api, id);
      const idea: Record<string, unknown> = {};
      if (str(flags.topic) !== undefined) idea.topic = flags.topic;
      if (str(flags.audience) !== undefined) idea.audience = flags.audience;
      return api.patch(`/api/projects/${id}/draft`, { expectedRevision: current.revision, idea });
    }
    case "brief": {
      const action = rest[1];
      const current = await api.get(`/api/projects/${id}/brief`);
      const revision = current.brief?.revision ?? 0;
      if (!action) return current;
      if (action === "refine") {
        const input: Record<string, unknown> = { rawRequest: str(flags.request) ?? "", researchMode: "off" };
        if (str(flags.audience)) input.audience = flags.audience;
        if (str(flags.script)) input.exactScript = await readFile(String(flags.script), "utf8");
        if (str(flags.direction)) input.directionId = flags.direction;
        return api.post(`/api/projects/${id}/brief/refine`, { expectedRevision: revision, input });
      }
      if (action === "answer") return api.post(`/api/projects/${id}/brief/answers`, { expectedRevision: revision, decisionId: "direction", choice: str(flags.choice) });
      if (action === "approve") return api.post(`/api/projects/${id}/brief/approve`, { expectedRevision: revision, contentHash: current.brief?.result?.contentHash });
      throw new Error("brief actions: refine, answer, approve");
    }
    case "plan": return api.post(`/api/projects/${id}/plan`);
    case "storyboard": {
      const current = await draft(api, id);
      if (str(flags.out)) { await writeFile(String(flags.out), JSON.stringify(current.plan, null, 2)); return { saved: flags.out, revision: current.revision, planValid: current.planValid }; }
      return current;
    }
    case "storyboard-put": {
      const current = await draft(api, id);
      const plan = JSON.parse(await readFile(rest[1], "utf8"));
      return api.patch(`/api/projects/${id}/draft`, { expectedRevision: current.revision, plan });
    }
    case "trace": {
      const { traceProgram } = await import("../src/trace/interpret.js");
      const code = await readFile(rest[1], "utf8");
      const input = JSON.parse(str(flags.input) ?? "[]");
      // The code runs here on your machine; the studio only receives the recorded steps.
      const traced = traceProgram(code, String(flags.entry), input);
      return api.post(`/api/projects/${id}/traces`, { language: "python", code, entry: flags.entry, input, returned: traced.returned, tracerVersion: "leela-trace@1", steps: traced.steps, summary: traced.summary });
    }
    case "stills": {
      const started = await api.post(`/api/projects/${id}/stills`, { sceneIds: list(flags.scenes) ?? [], redraw: Boolean(flags.redraw) });
      return wait ? waitJob(api, started.jobId) : started;
    }
    case "approve": {
      const current = await draft(api, id);
      const started = await api.post(`/api/projects/${id}/approve`, { draftRevision: current.revision, planHash: current.planHash, output: str(flags.output) ?? "mp4" });
      if (!wait) return started;
      const job = await waitJob(api, started.jobId);
      return { job, videos: (await api.get(`/api/projects/${id}/videos`)).items.slice(0, 1) };
    }
    case "job": return wait ? waitJob(api, id) : api.get(`/api/jobs/${id}`);
    case "cancel": return api.post(`/api/jobs/${id}/cancel`);
    case "retry": { const r = await api.post(`/api/jobs/${id}/retry`); return wait ? waitJob(api, id) : r; }
    case "videos": return api.get(`/api/projects/${id}/videos`);
    case "download": {
      const kind = str(flags.kind) ?? "mp4";
      const response = await api.call("GET", `/api/videos/${id}/file/${kind}?download=1`, undefined, true);
      const out = str(flags.out) ?? `${id}.${kind === "thumb" || kind === "sheet" ? "jpg" : kind}`;
      await writeFile(out, Buffer.from(await response.arrayBuffer()));
      return { saved: out };
    }
    case "share": return api.post(`/api/videos/${id}/share`, { allowDownload: Boolean(flags["allow-download"]) });
    case "unshare": await api.del(`/api/videos/${id}/share`); return { revoked: id };
    case "messages": return api.get(`/api/projects/${id}/messages`);
    case "copilot": {
      const sent = await api.post(`/api/projects/${id}/messages`, { text: rest[1] ?? "", sceneIds: list(flags.scenes) ?? [] });
      if (!flags.keep) return sent;
      const current = await draft(api, id);
      return api.post(`/api/messages/${sent.message.id}/keep`, { expectedRevision: current.revision });
    }
    case "keep": {
      const projectId = str(flags.project);
      if (!projectId) throw new Error("keep needs --project <id> so the current draft revision can be checked");
      const current = await draft(api, projectId);
      return api.post(`/api/messages/${id}/keep`, { expectedRevision: current.revision });
    }
    case "discard": return api.post(`/api/messages/${id}/discard`);
    case "upload": {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(await readFile(id))]), basename(id));
      return api.call("POST", "/api/library/assets", form);
    }
    case "assets": return api.get("/api/library/assets");
    case "montage": {
      const started = await api.post(`/api/projects/${id}/montage`, { assetIds: list(flags.clips) ?? [], musicAssetId: str(flags.music) ?? null, seconds: Number(flags.seconds ?? 15) });
      return wait ? waitJob(api, started.jobId) : started;
    }
    case "lyrics": {
      const current = await draft(api, id);
      return api.post(`/api/projects/${id}/lyrics`, { songAssetId: str(flags.song), lrc: await readFile(String(flags.lrc), "utf8"), expectedRevision: current.revision });
    }
    case "characters": return api.get("/api/characters");
    case "character": return api.get(`/api/characters/${id}`);
    case "character-create": {
      let referenceAssetId: string | undefined;
      if (str(flags.image)) {
        const form = new FormData();
        form.set("file", new Blob([new Uint8Array(await readFile(String(flags.image)))]), basename(String(flags.image)));
        referenceAssetId = (await api.call("POST", "/api/library/assets", form)).asset.id;
      }
      const made = await api.post("/api/characters", { name: str(flags.name), description: str(flags.description) ?? "", style: str(flags.style) ?? "storybook", referenceAssetId, rights: str(flags.rights) ?? "own" });
      return wait && made.jobId ? { ...made, job: await waitJob(api, made.jobId) } : made;
    }
    case "character-draw": { const r = await api.post(`/api/characters/${id}/draw`); return wait ? waitJob(api, r.jobId) : r; }
    case "series": return api.get("/api/series");
    case "series-get": return api.get(`/api/series/${id}`);
    case "series-create": return api.post("/api/series", { title: str(flags.title), logline: str(flags.logline) ?? "", mode: str(flags.mode) ?? "story", style: str(flags.style) ?? "storybook", world: str(flags.world) ?? "", tone: str(flags.tone) ?? "", rules: (str(flags.rules) ?? "").split(";").map((r) => r.trim()).filter(Boolean), castIds: list(flags.cast) ?? [] });
    case "series-set": {
      const current = (await api.get(`/api/series/${id}`)).series;
      const body: Record<string, unknown> = { expectedRevision: current.revision };
      for (const key of ["title", "logline", "mode", "style", "world", "tone"]) if (str(flags[key])) body[key] = flags[key];
      if (str(flags.rules)) body.rules = String(flags.rules).split(";").map((r) => r.trim()).filter(Boolean);
      if (flags.cast !== undefined) body.castIds = list(flags.cast) ?? [];
      return api.patch(`/api/series/${id}`, body);
    }
    case "series-approve": { const current = (await api.get(`/api/series/${id}`)).series; return api.post(`/api/series/${id}/versions`, { expectedRevision: current.revision }); }
    case "episode": return api.post(`/api/series/${id}/episodes`, { topic: str(flags.topic), title: str(flags.title) });
    case "invites": return api.get("/api/invites");
    case "invite": return api.post("/api/invites", { email: str(flags.email) });
    case "revoke-invite": return api.post(`/api/invites/${id}/revoke`);
    case "reset-link": return api.post("/api/resets", { email: str(flags.email) });
    case "tokens": return api.get("/api/tokens");
    case "token-create": return api.post("/api/tokens", { name: str(flags.name), days: Number(flags.days ?? 90) });
    case "token-revoke": await api.del(`/api/tokens/${id}`); return { revoked: id };
    case "api": {
      const data = str(flags.data);
      const body = data ? JSON.parse(data.startsWith("@") ? await readFile(data.slice(1), "utf8") : data) : undefined;
      return api.call(rest[0].toUpperCase(), rest[1], body);
    }
    default: throw new Error(`Unknown remote command "${command}".\n${HELP}`);
  }
}
