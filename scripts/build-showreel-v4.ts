/**
 * Renders the two homepage story films on the current 3D stage with a real narrator, then the
 * caller re-encodes them for the web. Usage: npx tsx scripts/build-showreel-v4.ts [voiceId]
 */
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { validatePlan } from "../src/contracts/plan";
import { loadEnv } from "../src/config/env";
import { voiceEntry } from "../src/config/providers";
import { renderFilm } from "../src/pipeline/render";

const voiceId = process.argv[2] ?? "sarvam:priya";
const meera = { name: "Meera", look: { skin: "#d9a477", hair: "#2b1a12", hairStyle: "ponytail", top: "#e07a3d", bottom: "#e07a3d", outfit: "dress", build: "child", accessory: "none" } };
const dadi = { name: "Dadi", look: { skin: "#c18a5c", hair: "#d8d8d8", hairStyle: "bun", top: "#7b2d8e", bottom: "#7b2d8e", outfit: "saree", build: "elder", accessory: "glasses" } };
const tikku = { name: "Tikku", look: { skin: "#c18a5c", hair: "#1a1410", hairStyle: "short", top: "#2a9d8f", bottom: "#33415c", outfit: "pants", build: "child", accessory: "cap" } };

type Beat = [string, string, string, string, number[], number, string?];
function plan(mode: "story" | "cartoon", title: string, look: "storybook" | "cartoon", cast: unknown[], beats: Beat[]) {
  return {
    schemaVersion: 1, mode, title, logline: beats[0][0], language: "en", format: "9x16", targetMs: 30000, styleId: "chalk-and-chai@1", voiceId, cast,
    scenes: beats.map(([text, set, action, shot, on, speaker, caption], i) => ({
      id: `s${i + 1}`, purpose: i === 0 ? "hook" : i === beats.length - 1 ? "recap" : "explain",
      lines: [{ id: "l1", text }], background: { kind: "style" }, events: [], holdMs: i === beats.length - 1 ? 900 : 250,
      layers: [
        { id: "stage", component: "stage.perform@1", props: { action, look, set, shot, on, speaker }, slot: "full" },
        ...(i === 0 ? [{ id: "kicker", component: "text.kicker@1", props: { text: title }, slot: "top" }] : caption ? [{ id: "caption", component: "text.kicker@1", props: { text: caption }, slot: "top" }] : []),
      ],
    })),
  };
}

const films = {
  "story-v4": plan("story", "Paper boat", "storybook", [meera, dadi], [
    ["Rain taps on the window, and Meera cannot go out to play.", "home", "sit", "wide", [0, 1], -1],
    ["Dadi tears a page from an old notebook and folds it into a tiny boat.", "home", "point", "medium", [1, 0], -1, "Fold, crease, fold"],
    ["When the rain stops, they hurry down the wet lane to the river.", "lane", "walk", "wide", [0, 1], -1, "To the river"],
    ["Meera sets the boat on the water and holds her breath.", "bank", "hold", "close", [0], -1, "Gently now"],
    ["It wobbles, then it sails, and Meera jumps up and claps.", "bank", "jump", "medium", [0, 1], -1, "It sails!"],
    ["Dadi, can we make a bigger one tomorrow?", "night", "talk", "close", [0, 1], 0, "Tomorrow?"],
  ]),
  "cartoon-v4": plan("cartoon", "Tikku crosses", "cartoon", [tikku], [
    ["Tikku spots the mango cart across the road.", "street", "point", "wide", [0], -1],
    ["He stops at the edge, and looks left, then right.", "lane", "turn", "medium", [0], -1, "Stop and look"],
    ["A bus rumbles past, so Tikku waits.", "lane", "hold", "medium", [0], -1, "Wait"],
    ["Now the road is clear. He walks across. He does not run.", "lane", "walk", "wide", [0], -1, "Walk, don't run"],
    ["Mango in hand, Tikku waves. Stop, look, then cross!", "market", "wave", "close", [0], 0, "Stop, look, cross"],
  ]),
};

const env = loadEnv();
const voice = voiceEntry(voiceId);
if (!voice) throw new Error(`Unknown voice ${voiceId}`);
for (const [name, raw] of Object.entries(films)) {
  const checked = validatePlan(raw);
  if (!checked.plan) throw new Error(`${name}: ${JSON.stringify(checked.issues)}`);
  const workDir = resolve(".data", "showreel-v4", name);
  mkdirSync(workDir, { recursive: true });
  const result = await renderFilm({ plan: checked.plan, voice, keys: env, workDir, cacheDir: resolve(".data", "cache", "voice"), quality: "standard" });
  copyFileSync(result.mp4, resolve(".data", "showreel-v4", `${name}.mp4`));
  copyFileSync(result.sheet, resolve(".data", "showreel-v4", `${name}-sheet.jpg`));
  console.log(name, result.qa.passed, (result.durationMs / 1000).toFixed(1), "s", result.warnings.join(" | "));
}
