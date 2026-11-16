import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plan } from "../contracts/plan";
import { compileHtml, type Timeline } from "./compile";

export function estimatedTimeline(plan: Plan): Timeline {
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

const fonts: Record<string, string> = {
  'bricolage.woff2': '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2',
  'kalam-deva.woff2': '@fontsource/kalam/files/kalam-devanagari-700-normal.woff2',
  'kalam-latin.woff2': '@fontsource/kalam/files/kalam-latin-700-normal.woff2',
  'caveat.woff2': '@fontsource/caveat/files/caveat-latin-600-normal.woff2',
};

/** Silent preview only. Runtime visibility is owned here, not in render compositions. */
export function previewHtml(plan: Plan, timeline = estimatedTimeline(plan)): string {
  let html = compileHtml({ plan, timeline });
  const gsap = readFileSync(resolve(process.cwd(), 'node_modules/gsap/dist/gsap.min.js'), 'utf8');
  html = html.replace('<script src="assets/gsap.min.js"></script>', () => `<script>${gsap.replace(/<\/script/gi, '<\\/script')}</script>`);
  for (const [name, source] of Object.entries(fonts)) {
    html = html.replaceAll(`assets/fonts/${name}`, `data:font/woff2;base64,${readFileSync(resolve(process.cwd(), 'node_modules', source)).toString('base64')}`);
  }
  html = html.replace('</body>', `<script>
const duration = ${timeline.durationMs / 1000};
const clips = [...document.querySelectorAll('.clip[data-start]')];
function showAt(time) {
  for (const clip of clips) {
    const start = Number(clip.dataset.start);
    clip.style.visibility = time >= start && time < start + Number(clip.dataset.duration) ? 'visible' : 'hidden';
  }
}
window.previewSeek = function(time) { tl.pause(); tl.seek(Math.max(0, Math.min(duration, time))); showAt(tl.time()); };
tl.to({}, { duration: 0.001 }, duration);
tl.eventCallback('onUpdate', () => showAt(tl.time()));
showAt(0);
document.fonts.ready.then(() => tl.play());
function resize() {
  const scale = Math.min(innerWidth / 1080, innerHeight / 1920);
  document.body.style.transformOrigin = '0 0';
  document.body.style.transform = 'scale(' + scale + ')';
}
addEventListener('resize', resize); resize();
</script></body>`);
  return html;
}
