import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { LAYOUTS, performedScenes } from "../compiler/compile";
import { cleanLook, mouthTrack } from "../compiler/stage";
import { renderFilm } from "./render";

const run = promisify(execFile);

/** Blender binary: BLENDER_BIN, the macOS app, or `blender` on PATH. */
export function blenderBin(): string | null {
  const candidates = [process.env.BLENDER_BIN, "/Applications/Blender.app/Contents/MacOS/Blender", "blender"].filter(Boolean) as string[];
  for (const bin of candidates) if ((bin === "blender" || existsSync(bin)) && spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 20000 }).status === 0) return bin;
  return null;
}

export function blenderAvailable(): boolean {
  return blenderBin() !== null;
}

/**
 * Cinematic 3D: the same stage (cast looks, sets, actions, shots, lip timing) rendered by Blender
 * EEVEE with soft shadows and depth, then composed with narration, text and captions exactly like
 * the real-time profile. Blender runs headless with --factory-startup and --disable-autoexec; the
 * only script it runs is our trusted scene builder, fed validated enums and numbers.
 */
export async function renderCinematic(opts: Parameters<typeof renderFilm>[0]) {
  const bin = blenderBin();
  if (!bin) throw new Error("Blender is not installed on this PC. Install it, or switch the project to the real-time 3D stage.");
  return renderFilm({
    ...opts,
    stageRenderer: async ({ plan, timeline, workDir, signal }) => {
      const scenes = performedScenes(plan, timeline);
      if (!scenes.length) return null;
      mkdirSync(workDir, { recursive: true });
      const layout = LAYOUTS[plan.format];
      const data = { w: layout.w, h: layout.h, fps: 30, duration: timeline.durationMs / 1000, scenes, mouth: mouthTrack(timeline.lines), cast: (plan.cast ?? []).map((m, i) => cleanLook(m.look, i)) };
      const json = resolve(workDir, "stage.json");
      writeFileSync(json, JSON.stringify(data));
      const frames = resolve(workDir, "frames");
      mkdirSync(frames, { recursive: true });
      const script = resolve(process.cwd(), "scripts", "blender", "stage.py");
      await run(bin, ["-b", "--factory-startup", "--disable-autoexec", "-noaudio", "-P", script, "--", json, frames], { timeout: 60 * 60_000, maxBuffer: 256 * 1024 * 1024, signal, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } as unknown as NodeJS.ProcessEnv });
      if (!existsSync(resolve(frames, "0001.png"))) throw new Error("Blender did not produce the stage frames.");
      const out = resolve(workDir, "stage.mp4");
      await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-framerate", "30", "-i", resolve(frames, "%04d.png"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", out], { timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024 });
      return out;
    },
  });
}
