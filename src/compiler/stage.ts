import type { TimedLine } from "./compile";

/**
 * Registered vocabulary of the 3D stage. The contract, the planner and the compiler all
 * read these lists, so a value is valid in exactly one place.
 */
export const STAGE_ACTIONS = ["talk", "walk", "turn", "wave", "hold", "point", "sit", "jump"] as const;
export const STAGE_LOOKS = ["storybook", "cartoon"] as const;
export const STAGE_SETS = ["home", "bank", "lane", "room", "street", "park", "school", "office", "night", "market"] as const;
export const STAGE_SHOTS = ["wide", "medium", "close"] as const;
export const HAIR_STYLES = ["short", "long", "ponytail", "bun", "bald", "curly"] as const;
export const OUTFITS = ["dress", "pants", "kurta", "saree"] as const;
export const BUILDS = ["child", "adult", "elder"] as const;
export const ACCESSORIES = ["none", "glasses", "cap", "scarf", "bindi"] as const;
export const SKIN_TONES = ["#f6d7b8", "#eac3a0", "#d9a477", "#c18a5c", "#9c6b45", "#6f4a30"] as const;

export type StageAction = (typeof STAGE_ACTIONS)[number];
export type StageLook = (typeof STAGE_LOOKS)[number];
export type StageSet = (typeof STAGE_SETS)[number];
export type StageShot = (typeof STAGE_SHOTS)[number];

/** How one performer looks. Colours are validated #rrggbb strings; everything else is an enum. */
export type PerformerLook = {
  skin: string;
  hair: string;
  hairStyle: (typeof HAIR_STYLES)[number];
  top: string;
  bottom: string;
  outfit: (typeof OUTFITS)[number];
  build: (typeof BUILDS)[number];
  accessory: (typeof ACCESSORIES)[number];
};

export type StageScene = {
  start: number;
  end: number;
  action: StageAction;
  look: StageLook;
  set: StageSet;
  shot: StageShot;
  /** Indexes into the cast list of who is on stage in this beat (1 to 3). */
  on: number[];
  /** Index into the cast list of who speaks, or -1 for narration only. */
  speaker: number;
};

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_CAST: PerformerLook[] = [
  { skin: "#eac3a0", hair: "#2b1a12", hairStyle: "ponytail", top: "#e07a3d", bottom: "#e07a3d", outfit: "dress", build: "child", accessory: "none" },
  { skin: "#c18a5c", hair: "#1a1410", hairStyle: "short", top: "#2a9d8f", bottom: "#33415c", outfit: "pants", build: "child", accessory: "none" },
  { skin: "#d9a477", hair: "#8a8a8a", hairStyle: "bun", top: "#7b5ea7", bottom: "#7b5ea7", outfit: "saree", build: "elder", accessory: "glasses" },
];

/** Fills gaps and drops anything that is not a registered value. Never trusts plan text. */
export function cleanLook(raw: unknown, index: number): PerformerLook {
  const base = DEFAULT_CAST[index % DEFAULT_CAST.length];
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : fallback);
  const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
  return {
    skin: hex(value.skin, base.skin),
    hair: hex(value.hair, base.hair),
    hairStyle: pick(HAIR_STYLES, value.hairStyle, base.hairStyle),
    top: hex(value.top, base.top),
    bottom: hex(value.bottom, base.bottom),
    outfit: pick(OUTFITS, value.outfit, base.outfit),
    build: pick(BUILDS, value.build, base.build),
    accessory: pick(ACCESSORIES, value.accessory, base.accessory),
  };
}

export function defaultLook(index: number): PerformerLook {
  return { ...DEFAULT_CAST[index % DEFAULT_CAST.length] };
}

/** How open the mouth is for one word. Vowels open wider. Times stay with the caller. */
export function mouthOpen(text: string): number {
  if (/[ouōūओऔउऊोौुू]/i.test(text)) return 0.9;
  if (/[aeāēअआएऐाेै]/i.test(text)) return 1;
  if (/[iīइईिी]/i.test(text)) return 0.45;
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
  return cues.sort((a, b) => a[0] - b[0]);
}

/**
 * Seekable Three.js stage. Every pose and camera move is a pure function of time, so any
 * frame can be drawn without playing the ones before it. The data block holds validated
 * enums, numbers and #rrggbb colours only; no plan text reaches this script.
 */
export function stageModule(opts: { width: number; height: number; scenes: StageScene[]; mouth: [number, number][]; cast: PerformerLook[] }): string {
  const cast = (opts.cast.length ? opts.cast : [defaultLook(0)]).slice(0, 3).map((look, i) => cleanLook(look, i));
  const data = JSON.stringify({ w: opts.width, h: opts.height, scenes: opts.scenes, mouth: opts.mouth, cast });
  return `import * as THREE from "three";
const data = ${data};
const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(data.w, data.h, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, data.w / data.h, 0.1, 60);
const portrait = data.h > data.w;
const hemi = new THREE.HemisphereLight(0xfff4e4, 0x2a2118, 1.35);
const key = new THREE.DirectionalLight(0xfff7ea, 1.8);
key.position.set(2.2, 4.2, 3.4);
scene.add(hemi, key);
const mat = (hex, rough = 0.6) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough });
const box = (w, h, d, hex, x, y, z, rough) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex, rough)); m.position.set(x, y, z); return m; };

const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), mat(0x3d2b1f, 0.9));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

/* ---------- sets: each is a group shown only in its beats ---------- */
const sets = {};
function set(name, build) { const g = new THREE.Group(); build(g); g.visible = false; scene.add(g); sets[name] = g; }
const tree = (g, x, z, s = 1) => { g.add(box(0.18 * s, 1.1 * s, 0.18 * s, 0x6b4a2f, x, 0.55 * s, z)); const c = new THREE.Mesh(new THREE.SphereGeometry(0.62 * s, 16, 12), mat(0x3f8f5a, 0.8)); c.position.set(x, 1.35 * s, z); g.add(c); };
const house = (g, x, z, hex) => { g.add(box(1.4, 1.2, 1, hex, x, 0.6, z, 0.8)); const r = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.7, 4), mat(0x8a3b2a, 0.7)); r.position.set(x, 1.55, z); r.rotation.y = Math.PI / 4; g.add(r); g.add(box(0.36, 0.6, 0.04, 0x5a3a22, x, 0.3, z + 0.52)); };
set("home", (g) => { g.add(box(7, 3.2, 0.2, 0xe9d8bf, 0, 1.6, -1.6, 0.9)); g.add(box(0.7, 1.3, 0.08, 0x8a5a32, -1.6, 0.66, -1.48)); g.add(box(1.0, 0.7, 0.06, 0x9fd3e6, 1.4, 1.75, -1.48, 0.2)); g.add(box(1.6, 0.5, 0.7, 0x7b5e45, 1.6, 0.25, -0.9)); });
set("bank", (g) => { g.add(box(9, 0.08, 1.8, 0x2f6f8f, 0, 0.02, 1.25, 0.25)); g.userData.boat = box(0.42, 0.08, 0.18, 0xfff6e4, -0.8, 0.1, 1.1); g.add(g.userData.boat); tree(g, -2.6, -1.2); tree(g, 2.4, -1.6, 1.2); });
set("lane", (g) => { g.add(box(9, 0.04, 1.2, 0x3a4150, 0, 0.02, 1.0, 0.85)); for (let i = -4; i <= 4; i++) g.add(box(0.5, 0.05, 0.08, 0xf3e6c8, i, 0.05, 1.0)); house(g, -2.4, -1.6, 0xd98f5b); house(g, 2.2, -1.8, 0x6fa8a0); });
set("room", (g) => { g.add(box(7, 3.2, 0.2, 0xcfe0d2, 0, 1.6, -1.6, 0.9)); g.add(box(1.8, 0.08, 0.9, 0x8a6a4a, 1.5, 0.75, -0.8)); for (const x of [0.75, 2.25]) for (const z of [-1.2, -0.4]) g.add(box(0.06, 0.75, 0.06, 0x6b4a2f, x, 0.37, z)); g.add(box(1.1, 0.8, 0.05, 0xffd36a, -1.6, 1.8, -1.48, 0.3)); });
set("street", (g) => { g.add(box(9, 0.05, 2.2, 0x55595f, 0, 0.02, 0.9, 0.9)); const tones = [0xd98f5b, 0x6fa8a0, 0xe5c76b, 0x9c7bb8, 0xc65d5d]; for (let i = 0; i < 5; i++) g.add(box(1.2, 1.4 + (i % 3) * 0.6, 1, tones[i], -3.2 + i * 1.6, 0.7 + (i % 3) * 0.3, -2)); });
set("park", (g) => { tree(g, -2.2, -1.2, 1.2); tree(g, 2.5, -1.8, 1.4); tree(g, 0.4, -2.6); g.add(box(1.4, 0.08, 0.4, 0x9a6b3f, 1.6, 0.42, -0.4)); for (const x of [1.05, 2.15]) g.add(box(0.08, 0.42, 0.4, 0x5a3a22, x, 0.21, -0.4)); const sun = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd36a })); sun.position.set(-2.4, 3.2, -4); g.add(sun); });
set("school", (g) => { g.add(box(7, 3.2, 0.2, 0xf1e3c6, 0, 1.6, -1.6, 0.9)); g.add(box(2.6, 1.2, 0.05, 0x24493a, 0, 1.75, -1.48, 0.5)); g.add(box(2.7, 0.08, 0.1, 0x8a6a4a, 0, 1.12, -1.44)); for (const x of [-1.8, 1.8]) g.add(box(0.9, 0.06, 0.5, 0xb08a5c, x, 0.6, -0.5)); });
set("office", (g) => { g.add(box(7, 3.2, 0.2, 0xdfe4ea, 0, 1.6, -1.6, 0.9)); g.add(box(2.0, 0.08, 0.8, 0x4a4f57, 1.4, 0.78, -0.8)); g.add(box(0.7, 0.45, 0.05, 0x111418, 1.4, 1.08, -1.0, 0.2)); for (let i = 0; i < 3; i++) g.add(box(0.8, 1.6, 0.05, 0x9fc3e6, -2.2 + i * 0.9, 1.9, -1.48, 0.15)); });
set("night", (g) => { const moon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff1c4 })); moon.position.set(2.2, 3.4, -5); g.add(moon); for (let i = 0; i < 40; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); s.position.set(((i * 37) % 100) / 100 * 12 - 6, 2 + ((i * 53) % 100) / 100 * 3, -6); g.add(s); } house(g, -2.3, -1.8, 0x3a4060); });
set("market", (g) => { const awn = [0xe07a3d, 0x2a9d8f, 0xffd36a]; const fruit = [0xff5f5f, 0xffb347, 0x9be27a, 0xffd36a]; for (let i = 0; i < 3; i++) { const x = -2.4 + i * 2.4; g.add(box(1.6, 0.7, 0.8, 0x8a6a4a, x, 0.35, -1.2)); const a = box(1.8, 0.06, 1.1, awn[i], x, 1.6, -1.1); a.rotation.x = -0.25; g.add(a); for (const dx of [-0.8, 0.8]) g.add(box(0.06, 1.6, 0.06, 0x5a3a22, x + dx, 0.8, -0.7)); for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(fruit[k], 0.5)); f.position.set(x - 0.45 + k * 0.3, 0.8, -1.1); g.add(f); } } });

const SET_LIGHT = {
  home: [0x2a1d14, 1.35, 1.8], bank: [0x1c2a33, 1.35, 1.8], lane: [0x1f2433, 1.3, 1.7], room: [0x1d2a24, 1.4, 1.7], street: [0x232831, 1.3, 1.8],
  park: [0x8fc7e8, 1.5, 2.0], school: [0x2a2418, 1.4, 1.7], office: [0x1f262e, 1.4, 1.6], night: [0x0b1024, 0.55, 0.6], market: [0x31220f, 1.45, 1.9],
};
const GROUND = { storybook: 0x3d2b1f, cartoon: 0x243056 };

/* ---------- performers: one rig per cast member, dressed from validated looks ---------- */
function actor(look) {
  const group = new THREE.Group();
  group.scale.setScalar(look.build === "child" ? 0.82 : look.build === "elder" ? 0.96 : 1.0);
  const hex = (v) => new THREE.Color(v).getHex();
  const skin = mat(hex(look.skin), 0.45);
  const top = mat(hex(look.top), 0.4);
  const bottom = mat(hex(look.bottom), 0.5);
  const hairMat = mat(hex(look.hair), 0.55);
  const ink = mat(0x2a2238, 0.4);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 6, 16), top);
  body.position.y = 1.15;
  let lower;
  if (look.outfit === "dress" || look.outfit === "saree") {
    const saree = look.outfit === "saree";
    lower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, saree ? 0.4 : 0.46, saree ? 0.95 : 0.55, 20), saree ? top : bottom);
    lower.position.y = saree ? 0.5 : 0.72;
    if (saree) { const drape = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.5), top); drape.position.set(0.18, 0.15, 0); drape.rotation.z = -0.5; body.add(drape); }
  } else {
    const kurta = look.outfit === "kurta";
    // Trousers and kurta reach down to the legs, so the body never shows a gap.
    lower = new THREE.Mesh(new THREE.CylinderGeometry(0.27, kurta ? 0.32 : 0.25, kurta ? 0.62 : 0.42, 16), kurta ? top : bottom);
    lower.position.y = kurta ? 0.72 : 0.77;
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20), skin);
  head.position.y = 0.62;
  const parts = [];
  if (look.hairStyle !== "bald") {
    const capHair = new THREE.Mesh(new THREE.SphereGeometry(0.37, 24, 16, 0, Math.PI * 2, 0, look.hairStyle === "short" ? Math.PI * 0.5 : Math.PI * 0.62), hairMat);
    capHair.position.set(0, 0.04, -0.03);
    parts.push(capHair);
    if (look.hairStyle === "long") { const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.14), hairMat); back.position.set(0, -0.24, -0.24); parts.push(back); }
    if (look.hairStyle === "ponytail") { const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 8), hairMat); tail.position.set(0, -0.18, -0.36); tail.rotation.x = 0.5; parts.push(tail); }
    if (look.hairStyle === "bun") { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), hairMat); bun.position.set(0, 0.22, -0.3); parts.push(bun); }
    if (look.hairStyle === "curly") for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hairMat); const a = (i / 9) * Math.PI * 2; c.position.set(Math.cos(a) * 0.3, 0.18 + Math.sin(i) * 0.05, Math.sin(a) * 0.3 - 0.05); parts.push(c); }
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), ink);
  const eyeL = eye.clone(); eyeL.position.set(-0.11, 0.04, 0.29);
  const eyeR = eye.clone(); eyeR.position.set(0.11, 0.04, 0.29);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(0x8a3050, 0.35));
  mouth.scale.set(1.4, 0.28, 0.4);
  mouth.position.set(0, -0.12, 0.28);
  parts.push(eyeL, eyeR, mouth);
  if (look.accessory === "glasses") { const rim = mat(0x111111, 0.3); for (const x of [-0.11, 0.11]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16), rim); r.position.set(x, 0.04, 0.32); parts.push(r); } }
  // Cap sits on the crown with the brim above the brows, so the eyes stay visible from the camera.
  if (look.accessory === "cap") { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.355, 0.13, 20), bottom); c.position.set(0, 0.33, -0.02); const brim = box(0.34, 0.025, 0.2, hex(look.bottom), 0, 0.28, 0.27); brim.rotation.x = -0.25; parts.push(c, brim); }
  if (look.accessory === "bindi") { const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0xc81e3a, 0.3)); b.position.set(0, 0.15, 0.335); parts.push(b); }
  if (look.accessory === "scarf") { const s = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 20), bottom); s.rotation.x = Math.PI / 2; s.position.set(0, 0.36, 0); body.add(s); }
  head.add(...parts);
  const sleeve = look.outfit === "kurta" || look.outfit === "saree" ? top : skin;
  // Each arm hangs from its own shoulder. One hand sphere, so a swing cannot read as a third limb.
  const arm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, 0.22, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), sleeve);
    upper.position.y = -0.16;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), skin);
    hand.position.y = -0.32;
    pivot.add(upper, hand);
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const legGeo = new THREE.CapsuleGeometry(0.08, 0.36, 4, 8);
  const legMat = look.outfit === "pants" || look.outfit === "kurta" ? bottom : skin;
  const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.14, 0.28, 0);
  const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.14, 0.28, 0);
  body.add(head, armL, armR);
  group.add(body, lower, legL, legR);
  group.visible = false;
  scene.add(group);
  return { group, body, head, mouth, armL, armR, legL, legR };
}
const actors = data.cast.map(actor);

function openAt(time) {
  let open = 0.06;
  for (const sample of data.mouth) { if (sample[0] > time) break; open = sample[1]; }
  return open;
}
function pose(a, action, local, span, open, x, facing) {
  const u = span <= 0 ? 0 : Math.min(1, Math.max(0, local / span));
  a.group.visible = true;
  a.group.position.set(x, 0, 0);
  a.group.rotation.set(0, facing, 0);
  a.body.position.y = 1.15; a.body.rotation.set(0, 0, 0);
  a.head.rotation.set(0, 0, 0);
  a.armL.rotation.set(0.15, 0, 0.2); a.armR.rotation.set(0.15, 0, -0.2);
  a.legL.rotation.set(0, 0, 0); a.legR.rotation.set(0, 0, 0);
  a.mouth.scale.y = 0.18 + open * 1.15;
  if (action === "walk") {
    a.group.position.x = x + (u * 2 - 1) * (Math.abs(x) > 0.2 ? 0.16 : 0.28);
    a.legL.rotation.x = Math.sin(local * 8) * 0.65; a.legR.rotation.x = Math.sin(local * 8 + Math.PI) * 0.65;
    a.armL.rotation.x = Math.sin(local * 8 + Math.PI) * 0.4; a.armR.rotation.x = Math.sin(local * 8) * 0.4;
    a.head.rotation.y = Math.sin(local * 2) * 0.22;
  } else if (action === "turn") {
    a.group.rotation.y = facing - 0.2 + u * 0.85;
    a.head.rotation.y = Math.sin(local * 2.4) * 0.4;
  } else if (action === "wave") {
    a.armR.rotation.z = -0.5 - Math.abs(Math.sin(local * 7)) * 1.25;
    a.head.rotation.z = Math.sin(local * 3) * 0.08;
  } else if (action === "point") {
    a.armR.rotation.z = -1.35; a.armR.rotation.y = 0.3;
    a.head.rotation.y = 0.35 + Math.sin(local * 1.4) * 0.08;
  } else if (action === "sit") {
    a.body.position.y = 0.82; a.legL.rotation.x = -1.4; a.legR.rotation.x = -1.4;
    a.head.rotation.y = Math.sin(local * 0.9) * 0.18;
  } else if (action === "jump") {
    const hop = Math.abs(Math.sin(local * 4.2));
    a.group.position.y = hop * 0.35; a.armL.rotation.z = 0.4 + hop; a.armR.rotation.z = -0.4 - hop;
  } else if (action === "hold") {
    a.group.position.y = Math.sin(local * 1.5) * 0.045;
    a.head.rotation.y = Math.sin(local * 0.8) * 0.16;
  } else {
    a.head.rotation.y = Math.sin(local * 1.6) * 0.32;
    a.head.rotation.x = Math.sin(local * 2.3) * 0.09;
    a.body.rotation.z = Math.sin(local * 1.3) * 0.035;
    a.armR.rotation.z = -0.18 - Math.max(0, Math.sin(local * 2.1)) * 0.35 * open;
  }
}
const SHOT = { wide: portrait ? 11.5 : 9.8, medium: portrait ? 9.4 : 8.0, close: portrait ? 6.6 : 5.8 };
function renderAt(time) {
  const t = Number.isFinite(time) ? time : 0;
  let shot = data.scenes[0];
  for (const s of data.scenes) if (t >= s.start && t < s.end + 0.001) shot = s;
  const light = SET_LIGHT[shot.set] || SET_LIGHT.home;
  scene.background = new THREE.Color(light[0]);
  hemi.intensity = light[1]; key.intensity = light[2];
  ground.material.color.setHex(shot.set === "park" ? 0x5f9a4a : shot.set === "night" ? 0x1a1d2c : GROUND[shot.look] || GROUND.storybook);
  for (const name in sets) sets[name].visible = name === shot.set;
  const span = Math.max(0.2, shot.end - shot.start);
  const local = Math.max(0, t - shot.start);
  const along = Math.min(1, local / span);
  const open = openAt(t);
  const on = shot.on.filter((i) => i >= 0 && i < actors.length);
  const spread = on.length === 3 ? 0.95 : 0.5;
  const xOf = (slot) => (on.length === 1 ? 0 : (slot - (on.length - 1) / 2) * spread * 2);
  for (const a of actors) a.group.visible = false;
  on.forEach((index, slot) => {
    const x = xOf(slot);
    const facing = on.length === 1 ? 0 : x < 0 ? 0.28 : -0.28;
    const speaking = shot.speaker === index || (shot.speaker === -1 && slot === 0);
    const action = slot === 0 || shot.action === "walk" || shot.action === "jump" ? shot.action : "talk";
    pose(actors[index], action, local + slot * 0.37, span, speaking ? open : 0.04, x, facing);
  });
  if (sets.bank.visible) { const boat = sets.bank.userData.boat; boat.position.x = -0.9 + along * 1.8; boat.position.y = 0.1 + Math.sin(local * 3) * 0.03; }
  // Slow push-in through each beat; the framing comes from the beat's shot size.
  const dist = SHOT[shot.shot] || SHOT.medium;
  const lookY = shot.shot === "close" ? 1.45 : portrait ? 1.15 : 1.05;
  const focus = shot.shot === "close" && on.includes(shot.speaker) ? xOf(on.indexOf(shot.speaker)) * 0.6 : 0;
  camera.position.set(focus + Math.sin(t * 0.2) * 0.08, lookY + 0.35, dist - along * 0.45);
  camera.lookAt(focus, lookY, 0);
  renderer.render(scene, camera);
}
window.__stage = renderAt;
window.addEventListener("hf-seek", (event) => {
  const time = event.detail && typeof event.detail.time === "number" ? event.detail.time : 0;
  renderAt(time);
});
renderAt(typeof window.__hfThreeTime === "number" ? window.__hfThreeTime : 0);
if (typeof window.__stageReady === "function") window.__stageReady();
`;
}
