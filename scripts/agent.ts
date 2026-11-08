/**
 * SceneSpindle paired PC agent.
 *
 *   npm run agent -- pair <CODE> --url https://your-studio
 *   npm run agent            (runs until stopped; renders jobs you queued for "My paired PC")
 *
 * The agent renders with this machine's own tools and keys (its .env.local) and never receives
 * the studio's database or provider credentials. Its token lives in ~/.scenespindle/agent.json.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import { loadEnv } from "../src/config/env";
import { voiceCandidates, voiceEntry, voiceUnavailable } from "../src/config/providers";
import { renderFilm, RENDERER } from "../src/pipeline/render";
import { renderMontage } from "../src/pipeline/montage";
import { songLines } from "../src/pipeline/lyrics";
import { montageSettingsSchema, resolveMontage } from "../src/catalog/montage-styles";
import { learnedStyle } from "../src/server/style-analysis";
import { renderCinematic, blenderAvailable } from "../src/pipeline/cinematic";
import { validatePlan } from "../src/contracts/plan";

const CONFIG = resolve(homedir(), ".scenespindle", "agent.json");
type Config = { url: string; token: string; name: string };

function capabilities() {
  const has = (cmd: string, flag = "-version") => spawnSync(cmd, [flag], { stdio: "ignore", timeout: 8000 }).status === 0;
  return { ffmpeg: has("ffmpeg"), chrome: true, blender: blenderAvailable(), os: platform(), version: "agent@1" };
}

async function api(cfg: Config, path: string, init: RequestInit = {}) {
  return fetch(`${cfg.url}${path}`, { ...init, headers: { authorization: `Bearer ${cfg.token}`, ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
}

async function download(url: string, dest: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download an input (${response.status}).`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  return dest;
}

async function pair(code: string, url: string) {
  const response = await fetch(`${url.replace(/\/$/, "")}/api/agents/pair`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ code, capabilities: capabilities() }) });
  const body = await response.json().catch(() => null) as { token?: string; agent?: { name: string }; error?: { message: string } } | null;
  if (!response.ok || !body?.token) throw new Error(body?.error?.message ?? `Pairing failed (${response.status}).`);
  mkdirSync(resolve(homedir(), ".scenespindle"), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify({ url: url.replace(/\/$/, ""), token: body.token, name: body.agent?.name ?? "PC" }, null, 2), { mode: 0o600 });
  console.log(`Paired as "${body.agent?.name}". Run: npm run agent`);
}

type Claimed = { id: string; leaseToken: string; output: string; inputs: Record<string, unknown> & { kind: string } };

async function work(cfg: Config, job: Claimed) {
  const dir = resolve(process.cwd(), ".data", "agent", job.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(resolve(dir, "in"), { recursive: true });
  const env = loadEnv();
  let lost = false;
  const stage = async (stages: { name: string; state: string }[], progress: number) => {
    const r = await api(cfg, `/api/agents/jobs/${job.id}/stage`, { method: "POST", body: JSON.stringify({ leaseToken: job.leaseToken, stages, progress }) });
    if (r.status === 409) { lost = true; throw new Error("STOP"); }
  };
  const beat = setInterval(() => { void api(cfg, `/api/agents/jobs/${job.id}/stage`, { method: "POST", body: JSON.stringify({ leaseToken: job.leaseToken, stages: [], progress: 0 }) }).then((r) => { if (r.status === 409) lost = true; }).catch(() => {}); }, 40_000);
  try {
    let made: { mp4: string; thumb: string; sheet: string; srt?: string; vtt?: string; durationMs: number; warnings: string[]; timing?: "aligned" | "estimated"; edl?: unknown };
    let voiceId: string | undefined;
    let commercial = false;
    let renderer = RENDERER;
    let silent = false;
    const stagesOf = (names: string[]) => async (name: string) => { const i = names.indexOf(name); await stage(names.map((n, k) => ({ name: n, state: k < i ? "done" : k === i ? "running" : "queued" })), Math.round((i / names.length) * 100)); };
    if (job.inputs.kind === "montage") {
      const i = job.inputs as unknown as { clips: { url: string; kind: "image" | "video"; ext: string }[]; music: { url: string; ext: string } | null; seconds: number; format: "9x16" | "16x9" | "1x1"; settings: unknown; learned: { spec?: unknown; base?: string } | null };
      const clips = [];
      for (const [n, clip] of i.clips.entries()) clips.push({ file: await download(clip.url, resolve(dir, "in", `clip-${n}.${clip.ext}`)), kind: clip.kind });
      const music = i.music ? await download(i.music.url, resolve(dir, "in", `music.${i.music.ext}`)) : null;
      const settings = montageSettingsSchema.parse(i.settings ?? {});
      const style = resolveMontage(settings, i.learned?.spec ? learnedStyle(i.learned.spec) : null);
      const result = await renderMontage({ clips, music, format: i.format, seconds: i.seconds, workDir: resolve(dir, "work"), style, settings, onStage: stagesOf(["beats", "cuts", "mix", "qa"]) });
      made = result;
      silent = !music && style.overlay === "none" && !style.sfx;
      renderer = `ffmpeg-montage@2+${style.id}`;
    } else {
      const i = job.inputs as unknown as { plan: unknown; voiceId: string | null; profile: string; trace: never; stills: Record<string, string>; song: string | null };
      const plan = validatePlan(i.plan).plan;
      if (!plan) throw new Error("The storyboard did not validate on this PC.");
      const images: Record<string, string> = {};
      for (const [id, url] of Object.entries(i.stills)) images[id] = await download(url, resolve(dir, "in", `still-${id}.png`));
      const songMode = plan.mode === "lyrics";
      const voice = songMode ? { ...voiceEntry("test:tone")!, id: "song", label: "Song", commercial: false } : voiceEntry(String(i.voiceId ?? ""));
      if (!voice) throw new Error("Unknown narrator.");
      const blocked = songMode || voiceCandidates(voice.id, plan.language, env).length ? null : voiceUnavailable(voice, env, plan.language) ?? "No narrator is configured for this language.";
      if (blocked) throw new Error(`This PC cannot use that narrator: ${blocked}`);
      const song = songMode && i.song ? { file: await download(i.song, resolve(dir, "in", "song.mp3")), lines: songLines(plan) } : undefined;
      const common = { plan, voice, keys: env, workDir: resolve(dir, "work"), cacheDir: resolve(process.cwd(), ".data", "cache", "voice"), images, song, trace: i.trace ?? undefined, onStage: stagesOf(["voice", "timeline", "frames", "mix", "qa"]) };
      const result = i.profile === "cinematic-3d" ? await renderCinematic(common) : await renderFilm(common);
      made = result;
      voiceId = songMode ? undefined : result.voiceId;
      commercial = result.voiceCommercial;
      renderer = i.profile === "cinematic-3d" ? `blender-eevee+${RENDERER}` : RENDERER;
    }
    if (lost) throw new Error("STOP");
    const form = new FormData();
    const sha256 = createHash("sha256").update(readFileSync(made.mp4)).digest("hex");
    form.set("meta", JSON.stringify({ leaseToken: job.leaseToken, sha256, durationMs: made.durationMs, warnings: made.warnings.slice(0, 20), timing: made.timing, voiceId, renderer, commercial, silent, edl: made.edl }));
    form.set("mp4", new Blob([readFileSync(made.mp4)], { type: "video/mp4" }), "film.mp4");
    form.set("thumb", new Blob([readFileSync(made.thumb)]), "thumb.jpg");
    form.set("sheet", new Blob([readFileSync(made.sheet)]), "sheet.jpg");
    if (made.srt && existsSync(made.srt)) form.set("srt", new Blob([readFileSync(made.srt)]), "captions.srt");
    if (made.vtt && existsSync(made.vtt)) form.set("vtt", new Blob([readFileSync(made.vtt)]), "captions.vtt");
    const r = await api(cfg, `/api/agents/jobs/${job.id}/result`, { method: "POST", body: form });
    const body = await r.json().catch(() => null) as { qaPassed?: boolean; error?: { message: string } } | null;
    if (!r.ok) throw new Error(body?.error?.message ?? `Upload failed (${r.status}).`);
    console.log(`Job ${job.id}: uploaded, ${body?.qaPassed ? "passed QA" : "did not pass QA"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    if (message !== "STOP" && !lost) {
      console.error(`Job ${job.id} failed: ${message}`);
      await api(cfg, `/api/agents/jobs/${job.id}/fail`, { method: "POST", body: JSON.stringify({ leaseToken: job.leaseToken, message: message.slice(0, 280), retryable: true }) }).catch(() => {});
    } else console.log(`Job ${job.id}: stopped (cancelled or reassigned).`);
  } finally {
    clearInterval(beat);
    if (!process.env.KEEP_RENDER_WORK) rmSync(dir, { recursive: true, force: true });
  }
}

async function loop() {
  if (!existsSync(CONFIG)) throw new Error("This PC is not paired. Run: npm run agent -- pair <CODE> --url <studio url>");
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8")) as Config;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  await api(cfg, "/api/agents/heartbeat", { method: "POST", body: JSON.stringify({ capabilities: capabilities() }) });
  console.log(`Agent "${cfg.name}" waiting for jobs from ${cfg.url}`);
  let beats = 0;
  while (!stopping) {
    try {
      if (beats++ % 12 === 0) {
        const hb = await api(cfg, "/api/agents/heartbeat", { method: "POST", body: "{}" });
        if (hb.status === 401) throw new Error("This PC was unpaired. Pair it again from Settings.");
      }
      const r = await api(cfg, "/api/agents/claim", { method: "POST", body: "{}" });
      if (r.status === 401) throw new Error("This PC was unpaired. Pair it again from Settings.");
      if (r.status === 200) { const { job } = await r.json() as { job: Claimed }; console.log(`Claimed job ${job.id} (${job.inputs.kind})`); await work(cfg, job); continue; }
    } catch (error) {
      if (error instanceof Error && /unpaired/.test(error.message)) throw error;
      console.error("agent:", error instanceof Error ? error.message : error);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
(command === "pair" ? pair(rest[0] ?? "", flag("--url") ?? "http://localhost:3000") : loop()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
