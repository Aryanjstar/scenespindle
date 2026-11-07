import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Public runtime files that compiled previews load: Three.js and the film fonts. Allowlisted only. */
const FILES: Record<string, [string, string]> = {
  "three.module.js": ["node_modules/three/build/three.module.js", "text/javascript; charset=utf-8"],
  "three.core.js": ["node_modules/three/build/three.core.js", "text/javascript; charset=utf-8"],
  "bricolage.woff2": ["node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2", "font/woff2"],
  "kalam-deva.woff2": ["node_modules/@fontsource/kalam/files/kalam-devanagari-700-normal.woff2", "font/woff2"],
  "kalam-latin.woff2": ["node_modules/@fontsource/kalam/files/kalam-latin-700-normal.woff2", "font/woff2"],
  "caveat.woff2": ["node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2", "font/woff2"],
  "anek-deva.woff2": ["node_modules/@fontsource/anek-devanagari/files/anek-devanagari-devanagari-700-normal.woff2", "font/woff2"],
  "mono.woff2": ["node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2", "font/woff2"],
};

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const entry = FILES[file];
  if (!entry) return new Response("Not found", { status: 404 });
  return new Response(readFileSync(resolve(process.cwd(), entry[0])), {
    headers: {
      "content-type": entry[1],
      "cache-control": "public, max-age=86400",
      // Previews render in a sandboxed (opaque-origin) frame, so module scripts and fonts need CORS.
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
