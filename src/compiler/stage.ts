import type { TimedLine } from "./compile";

export const STAGE_ACTIONS = ["talk", "walk", "turn", "wave", "hold"] as const;
export const STAGE_LOOKS = ["storybook", "cartoon"] as const;
export type StageAction = (typeof STAGE_ACTIONS)[number];
export type StageLook = (typeof STAGE_LOOKS)[number];

export type StageScene = {
  start: number;
  end: number;
  action: StageAction;
  look: StageLook;
  rigs: 1 | 2;
};

/** How open the mouth is for one word. Vowels open wider. Times stay with the caller. */
export function mouthOpen(text: string): number {
  if (/[oōuūओऔउऊ\u094b\u094c\u0941\u0942]/i.test(text)) return 0.9;
  if (/[aāeēअआइएऐ\u093e\u0947\u0948]|a|e/i.test(text)) return 1;
  if (/[iīइई\u093f\u0940]|i/i.test(text)) return 0.45;
  if (/[\p{L}\p{N}]/u.test(text)) return 0.22;
  return 0.05;
}

/** Mouth samples at absolute seconds: open on the word, nearly shut at its end. */
export function mouthTrack(lines: TimedLine[]): [number, number][] {
  const cues: [number, number][] = [];
  for (const line of lines) {
    const words = line.words.length ? line.words : [{ text: line.text, startMs: 0, endMs: Math.max(200, line.durationMs) }];
    for (const word of words) {
      const start = (line.startMs + word.startMs) / 1000;
      const end = (line.startMs + word.endMs) / 1000;
      cues.push([Number(start.toFixed(3)), mouthOpen(word.text)]);
      cues.push([Number(Math.max(start + 0.04, end).toFixed(3)), 0.06]);
    }
  }
  return cues;
}

/**
 * Seekable Three.js stage. Every pose is a function of time, so a frame can be
 * drawn without playing the ones before it. The scene list is validated enums
 * and numbers; nothing from the plan is interpolated into the script as text.
 */
export function stageModule(opts: { width: number; height: number; scenes: StageScene[]; mouth: [number, number][] }): string {
  const data = JSON.stringify({ w: opts.width, h: opts.height, scenes: opts.scenes, mouth: opts.mouth });
  return `import * as THREE from "three";
const data = ${data};
const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(data.w, data.h, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, data.w / data.h, 0.1, 40);
const portrait = data.h > data.w;
const camZ = portrait ? 10.2 : 8.6;
const lookY = portrait ? 1.15 : 1.05;
camera.position.set(0, lookY + 0.35, camZ);
camera.lookAt(0, lookY, 0);
scene.add(new THREE.HemisphereLight(0xfff4e4, 0x2a2118, 1.35));
const key = new THREE.DirectionalLight(0xfff7ea, 1.8);
key.position.set(2.2, 4.2, 3.4);
scene.add(key);
const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const PALETTE = {
  storybook: { bg: 0x1c140c, skin: 0xf0c9a0, cloth: 0xe07a3d, ink: 0x2a2238, ground: 0x3d2b1f, accent: 0x2a9d8f },
  cartoon: { bg: 0x14182a, skin: 0xffd36a, cloth: 0xff5fa2, ink: 0x10141f, ground: 0x243056, accent: 0x3de3f5 },
};
function actor(clothHex) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c9a0, roughness: 0.5 });
  const cloth = new THREE.MeshStandardMaterial({ color: clothHex, roughness: 0.42 });
  const ink = new THREE.MeshStandardMaterial({ color: 0x2a2238, roughness: 0.4 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x6b2a3a, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.62, 6, 16), cloth);
  body.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 28, 20), skin);
  head.position.y = 0.72;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), ink);
  const eyeL = eye.clone();
  eyeL.position.set(-0.12, 0.05, 0.31);
  const eyeR = eye.clone();
  eyeR.position.set(0.12, 0.05, 0.31);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), mouthMat);
  mouth.scale.set(1.35, 0.22, 0.45);
  mouth.position.set(0, -0.12, 0.3);
  head.add(eyeL, eyeR, mouth);
  const armGeo = new THREE.CapsuleGeometry(0.08, 0.46, 4, 8);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.48, 0.12, 0);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.48, 0.12, 0);
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.42, 4, 8);
  const legL = new THREE.Mesh(legGeo, ink);
  legL.position.set(-0.16, 0.42, 0);
  const legR = new THREE.Mesh(legGeo, ink);
  legR.position.set(0.16, 0.42, 0);
  body.add(head, armL, armR);
  group.add(body, legL, legR);
  scene.add(group);
  return { group, body, head, mouth, armL, armR, legL, legR, skin, cloth, ink };
}
const lead = actor(0xe07a3d);
const pal = actor(0x2a9d8f);
function openAt(time) {
  let open = 0.06;
  for (const sample of data.mouth) {
    if (sample[0] > time) break;
    open = sample[1];
  }
  return open;
}
function pose(actor, action, local, span, open, x) {
  const u = span <= 0 ? 0 : Math.min(1, Math.max(0, local / span));
  actor.group.position.set(x, 0, 0);
  actor.group.rotation.set(0, 0, 0);
  actor.body.position.y = 1.2;
  actor.body.rotation.set(0, 0, 0);
  actor.head.rotation.set(0, 0, 0);
  actor.armL.rotation.set(0, 0, 0.18);
  actor.armR.rotation.set(0, 0, -0.18);
  actor.legL.rotation.set(0, 0, 0);
  actor.legR.rotation.set(0, 0, 0);
  actor.mouth.scale.y = 0.18 + open * 1.15;
  if (action === "walk") {
    const travel = Math.abs(x) > 0.2 ? 0.16 : 0.28;
    actor.group.position.x = x + (u * 2 - 1) * travel;
    actor.legL.rotation.x = Math.sin(local * 8) * 0.65;
    actor.legR.rotation.x = Math.sin(local * 8 + Math.PI) * 0.65;
    actor.armL.rotation.x = Math.sin(local * 8 + Math.PI) * 0.4;
    actor.armR.rotation.x = Math.sin(local * 8) * 0.4;
    actor.head.rotation.y = Math.sin(local * 2) * 0.22;
    actor.head.rotation.x = Math.sin(local * 4) * 0.05;
  } else if (action === "turn") {
    actor.group.rotation.y = -0.2 + u * 0.85;
    actor.head.rotation.y = Math.sin(local * 2.4) * 0.4;
    actor.head.rotation.x = 0.04;
  } else if (action === "wave") {
    actor.armR.rotation.z = -0.5 - Math.abs(Math.sin(local * 7)) * 1.25;
    actor.head.rotation.z = Math.sin(local * 3) * 0.08;
    actor.head.rotation.y = 0.28;
  } else if (action === "hold") {
    actor.group.position.y = Math.sin(local * 1.5) * 0.045;
    actor.head.rotation.y = Math.sin(local * 0.8) * 0.16;
    actor.head.rotation.x = Math.sin(local * 1.1) * 0.04;
  } else {
    actor.head.rotation.y = Math.sin(local * 1.6) * 0.32;
    actor.head.rotation.x = Math.sin(local * 2.3) * 0.09;
    actor.body.rotation.z = Math.sin(local * 1.3) * 0.035;
    actor.body.position.y = 1.2 + Math.sin(local * 1.8) * 0.02;
  }
}
function renderAt(time) {
  const t = Number.isFinite(time) ? time : 0;
  let shot = data.scenes[0];
  for (const scene of data.scenes) {
    if (t >= scene.start && t < scene.end + 0.001) shot = scene;
  }
  const look = PALETTE[shot.look] || PALETTE.storybook;
  scene.background = new THREE.Color(look.bg);
  ground.material.color.setHex(look.ground);
  for (const who of [lead, pal]) {
    who.skin.color.setHex(look.skin);
    who.ink.color.setHex(look.ink);
  }
  lead.cloth.color.setHex(look.cloth);
  pal.cloth.color.setHex(look.accent);
  const span = Math.max(0.2, shot.end - shot.start);
  const local = Math.max(0, t - shot.start);
  const open = openAt(t);
  pal.group.visible = shot.rigs === 2;
  pose(lead, shot.action, local, span, open, shot.rigs === 2 ? -0.46 : 0);
  if (shot.rigs === 2) pose(pal, shot.action === "walk" ? "talk" : shot.action, local, span, open * 0.85, 0.46);
  camera.position.z = camZ - Math.sin(t * 0.35) * 0.1;
  camera.position.x = Math.sin(t * 0.2) * 0.08;
  camera.lookAt(0, lookY, 0);
  renderer.render(scene, camera);
}
window.__stage = renderAt;
window.addEventListener("hf-seek", (event) => {
  const time = event.detail && typeof event.detail.time === "number" ? event.detail.time : 0;
  renderAt(time);
});
renderAt(typeof window.__hfThreeTime === "number" ? window.__hfThreeTime : 0);
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady.stage = Promise.resolve();
`;
}
