import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { type Plan } from "../contracts/plan";
import { compileProject, type CompileTrace, type Timeline } from "../compiler/compile";
import { findProtected } from "../config/protected";
import { Project } from "./db";
import { songTimeline } from "../pipeline/render";
import { songLines } from "../pipeline/lyrics";

export function hashPlan(plan: unknown): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

/** Lyric previews use the same timeline as the render: line times from the lyric file. */
function lyricTimeline(plan: Plan): Timeline {
  const lines = songLines(plan);
  const lastEnd = Math.max(0, ...lines.map((line) => line.endMs));
  return songTimeline(plan, lines, Math.max(plan.targetMs, lastEnd + 2500));
}

export function estimatedTimeline(plan: Plan): Timeline {
  if (plan.mode === "lyrics" && plan.scenes.some((scene) => scene.lines.some((line) => line.atMs !== undefined))) return lyricTimeline(plan);
  let cursor = 320;
  const scenes: Timeline["scenes"] = [];
  const lines: Timeline["lines"] = [];
  for (const scene of plan.scenes) {
    const start = cursor;
    for (const line of scene.lines) {
      const words = line.text.split(/\s+/).filter(Boolean);
      const durationMs = Math.max(2400, words.length * 380);
      const slice = durationMs / Math.max(words.length, 1);
      lines.push({
        sceneId: scene.id,
        lineId: line.id,
        text: line.text,
        audioFile: "data:,",
        startMs: cursor,
        durationMs,
        words: words.map((text, index) => ({
          text,
          startMs: Math.round(index * slice),
          endMs: Math.round((index + 1) * slice),
        })),
      });
      cursor += durationMs + 180;
    }
    cursor += scene.holdMs ?? 160;
    scenes.push({ id: scene.id, startMs: start, durationMs: cursor - start });
  }
  return { durationMs: cursor, scenes, lines };
}

export function previewHtml(plan: Plan, timeline = estimatedTimeline(plan), trace?: CompileTrace): string {
  const images: Record<string, string> = {};
  for (const scene of plan.scenes) for (const layer of scene.layers) {
    if (layer.component === "image.still@1" && typeof layer.props.assetId === "string" && /^[a-f0-9]{24}$/.test(layer.props.assetId)) images[layer.props.assetId] = `/api/assets/${layer.props.assetId}/file`;
  }
  const hash = hashPlan(plan).slice(0, 16);
  const dir = resolve(process.cwd(), ".data", "previews", hash);
  mkdirSync(dir, { recursive: true });
  compileProject({ plan, timeline, outDir: dir, trace, images });
  let html = readFileSync(resolve(dir, "index.html"), "utf8");
  html = html.replace("src=\"assets/gsap.min.js\"", "src=\"/api/runtime/gsap\"");
  // Runtime files come from the static route; the stage module (enums and numbers only) is inlined,
  // so a stored preview keeps working after the compile folder is gone.
  html = html.replaceAll("url(\"assets/fonts/", "url(\"/api/runtime/static/").replaceAll("\"./assets/three.module.js\"", "\"/api/runtime/static/three.module.js\"");
  const stageFile = resolve(dir, "assets", "stage.mjs");
  if (html.includes("src=\"assets/stage.mjs\"") && existsSync(stageFile)) {
    html = html.replace("<script type=\"module\" src=\"assets/stage.mjs\"></script>", () => `<script type="module">${readFileSync(stageFile, "utf8").replaceAll("</script", "<\\/script")}</script>`);
  }
  html = html.replace(
    "window.__timelines[\"main\"] = tl;",
    "window.__timelines = window.__timelines || {}; window.__timelines[\"main\"] = tl; tl.play();",
  );
  return html;
}

export async function ownProject(ownerId: mongoose.Types.ObjectId, id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Project.findOne({ _id: id, ownerId });
}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function characterAllowed(name: string): string | null {
  return findProtected(name);
}
