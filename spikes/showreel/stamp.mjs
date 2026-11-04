import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const films = ["leela-launch", "code-lab", "guest-list", "story", "wedding-home"];
const meta = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
};
const pkg = {
  private: true,
  type: "module",
  scripts: {
    check: "npx --yes hyperframes@0.8.176 check",
    render: "npx --yes hyperframes@0.8.176 render",
  },
};

for (const name of films) {
  const dir = resolve(root, name);
  mkdirSync(resolve(dir, "assets/fonts"), { recursive: true });
  cpSync(resolve(root, "_assets/gsap.min.js"), resolve(dir, "assets/gsap.min.js"));
  cpSync(resolve(root, "_assets/fonts"), resolve(dir, "assets/fonts"), { recursive: true });
  writeFileSync(resolve(dir, "hyperframes.json"), JSON.stringify(meta, null, 2));
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name, ...pkg }, null, 2));
}
console.log("stamped");
