import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planProject, sceneCount, splitScript } from '../src/pipeline/planner.js';
import { keyStates, stateOf } from '../src/trace/states.js';
import { traceProgram } from '../src/trace/interpret.js';
import { beatsFromSamples, cutPoints } from '../src/pipeline/montage.js';
import { applyEdits, paceScenes } from '../src/modules/revisions/rewrite.js';
import { compileProject, LAYOUTS } from '../src/compiler/compile.js';
import { estimatedTimeline } from '../src/server/studio.js';
import { validatePlan, type Plan } from '../src/contracts/plan.js';
import { lyricsPlan } from '../src/pipeline/lyrics.js';
import { parseCaptionText } from '../src/pipeline/caption-reel.js';

const SEARCH = `def binary_search(arr, target):\n  lo = 0\n  hi = len(arr) - 1\n  while lo <= hi:\n    mid = (lo + hi) // 2\n    if arr[mid] == target:\n      return mid\n    if arr[mid] < target:\n      lo = mid + 1\n    else:\n      hi = mid - 1\n  return -1\n`;
const SCRIPT = 'Every autumn, green leaves turn yellow. The green comes from chlorophyll. When days get shorter, the tree stops making it. The green fades and hidden colours show. So the colour was there all along.';

function compiled(plan: Plan, trace?: Parameters<typeof compileProject>[0]['trace']) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-compile-'));
  try {
    compileProject({ plan, timeline: estimatedTimeline(plan), outDir: dir, trace });
    return readFileSync(join(dir, 'index.html'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('scene counts follow the target length', () => {
  assert.deepEqual([15000, 30000, 45000, 75000, 120000].map(sceneCount), [4, 4, 5, 5, 6]);
});

test('exact scripts are split at sentence ends without changing a character', () => {
  const parts = splitScript(SCRIPT, 4);
  assert.equal(parts.length, 4);
  assert.equal(parts.join(' '), SCRIPT);
  assert.ok(parts.every((part) => /[.!?]$/.test(part)));
  assert.deepEqual(splitScript('एक। दो। तीन। चार।', 4), ['एक।', 'दो।', 'तीन।', 'चार।']);
});

test('offline planning keeps an exact script verbatim in the chosen language and format', async () => {
  const result = await planProject({ topic: 'Leaves', language: 'en', format: '1x1', targetMs: 45000, mode: 'explainer', voiceId: 'test:tone', brief: { exactScript: SCRIPT } });
  assert.equal(result.source, 'offline');
  assert.equal(result.plan.format, '1x1');
  assert.equal(result.plan.scenes.map((scene) => scene.lines[0].text).join(' '), SCRIPT);
  await assert.rejects(planProject({ topic: 'Leaves', language: 'en', format: '9x16', targetMs: 45000, mode: 'explainer', voiceId: 'x' }), /planner key is not set/);
});

test('Code Lab plans take every value from the recorded trace', async () => {
  const run = traceProgram(SEARCH, 'binary_search', [[4, 9, 15, 21, 28, 33, 40, 52], 33]);
  const states = keyStates(run.steps);
  assert.ok(states.length > 3 && states.length <= 40);
  const last = states[states.length - 1];
  assert.deepEqual(Object.fromEntries(last.pointers), { lo: 4, hi: 7, mid: 5 });
  const result = await planProject({ topic: 'Binary search', language: 'en', format: '9x16', targetMs: 45000, mode: 'code_lab', voiceId: 'test:tone', trace: { entry: 'binary_search', input: [[4, 9, 15, 21, 28, 33, 40, 52], 33], returned: run.returned, states, code: SEARCH } });
  assert.equal(result.plan.mode, 'code_lab');
  const slam = result.plan.scenes[4].layers.find((layer) => layer.component === 'text.slam@1');
  assert.equal(slam?.props.text, '5');
  const html = compiled(result.plan, { states, code: SEARCH + '<script>alert(1)</script>' });
  assert.match(html, /class="cell focus"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test('recursion traces show the call stack', () => {
  const run = traceProgram('def fib(n):\n  if n <= 1:\n    return n\n  return fib(n - 1) + fib(n - 2)\n', 'fib', [4]);
  const deepest = keyStates(run.steps).reduce((max, state) => Math.max(max, state.stack.length), 0);
  assert.equal(deepest, 4);
  assert.equal(stateOf(run.steps[0]).array, null);
});

test('every format compiles to its own canvas, and Hindi plans declare their language', () => {
  const base = JSON.parse(readFileSync('examples/plans/why-ice-floats.json', 'utf8'));
  for (const format of ['9x16', '16x9', '1x1'] as const) {
    const plan = validatePlan({ ...base, format }).plan!;
    const html = compiled(plan);
    assert.match(html, new RegExp(`data-width="${LAYOUTS[format].w}" data-height="${LAYOUTS[format].h}"`));
  }
  const hindi = validatePlan(JSON.parse(readFileSync('examples/plans/chand-kyon-nahi-girta-hi.json', 'utf8'))).plan!;
  const html = compiled(hindi);
  assert.match(html, /<html lang="hi"/);
  assert.match(html, /धरती/);
});

test('story plans perform on a 3D stage instead of a still', async () => {
  const script = 'Meera walks to the river. She waves at the paper boat. She turns and holds it close. The boat sails away. Meera talks to the water. Then she walks home.';
  const result = await planProject({ topic: 'Paper boat', language: 'en', format: '9x16', targetMs: 45000, mode: 'story', voiceId: 'test:tone', brief: { exactScript: script }, cast: [{ id: 'a'.repeat(24), name: 'Meera', description: 'A girl' }, { id: 'b'.repeat(24), name: 'Boat', description: 'A boat' }] });
  assert.equal(result.plan.mode, 'story');
  assert.ok(result.plan.scenes.every((scene) => scene.layers.some((layer) => layer.component === 'stage.perform@1')));
  assert.equal(result.plan.scenes[0].layers[0].props.action, 'walk');
  assert.equal(result.plan.scenes[0].layers[0].props.rigs, 2);
  const html = compiled(result.plan);
  assert.match(html, /three\.module\.js/);
  assert.match(html, /id="stage"/);
  assert.doesNotMatch(html, /class="still"/);
});

test('lyric films place each line on its sung time over a dark stage', () => {
  const plan = lyricsPlan({
    title: 'Spindle',
    lrc: '[00:01.00] Paper boat\n[00:03.50] Sail away now',
    songAssetId: 'a'.repeat(24),
    language: 'en',
    format: '9x16',
  });
  const html = compiled(plan);
  assert.match(html, /class="lyric-line"/);
  assert.match(html, /#120d18/);
  assert.doesNotMatch(html, /class="kword/);
});

test('caption text keeps SRT times and spaces plain lines evenly', () => {
  const srt = parseCaptionText('1\n00:00:01,200 --> 00:00:02,400\nHello boat', 5000);
  assert.equal(srt.timing, 'file');
  assert.equal(srt.cues[0].startMs, 1200);
  assert.equal(srt.cues[0].text, 'Hello boat');
  const plain = parseCaptionText('One line\nTwo lines', 4000);
  assert.equal(plain.timing, 'even');
  assert.equal(plain.cues.length, 2);
  assert.equal(plain.cues[0].startMs, 0);
  assert.ok(plain.cues[1].startMs > plain.cues[0].endMs - 80);
});

test('audio films draw words from the timeline and skip the caption band', async () => {
  const result = await planProject({ topic: 'Leaves', language: 'en', format: '9x16', targetMs: 45000, mode: 'audio', voiceId: 'test:tone', brief: { exactScript: SCRIPT } });
  const html = compiled(result.plan);
  assert.match(html, /class="kword/);
  assert.doesNotMatch(html, /class="cap clip"/);
  assert.ok(!validatePlan({ ...result.plan, mode: 'explainer' }).plan, 'kinetic layers need an audio plan');
});

test('copilot edits touch only the allowed scenes and respect a locked script', () => {
  const plan = validatePlan(JSON.parse(readFileSync('examples/plans/why-ice-floats.json', 'utf8'))).plan!;
  const edits = [{ id: 's2', narration: 'A brand new second line for the film.', title: 'New title' }, { id: 's3', title: 'Should not apply' }];
  const open = applyEdits(plan, edits, { lockNarration: false, allowed: ['s2'] });
  assert.deepEqual(open.changedSceneIds, ['s2']);
  assert.equal(open.plan.scenes[1].lines[0].text, 'A brand new second line for the film.');
  assert.deepEqual(open.plan.scenes[2], plan.scenes[2]);
  const locked = applyEdits(plan, edits, { lockNarration: true, allowed: ['s2'] });
  assert.equal(locked.plan.scenes[1].lines[0].text, plan.scenes[1].lines[0].text);
  const faster = paceScenes(plan, ['s1'], -160);
  assert.deepEqual(faster.changedSceneIds, ['s1']);
  assert.equal(faster.plan.scenes[1], plan.scenes[1]);
});

test('beat detection finds tempo and phase, and cuts land on beats', () => {
  const rate = 11025;
  const samples = new Int16Array(rate * 8);
  for (let k = 0; k < 16; k++) {
    const at = Math.round((0.25 + k * 0.5) * rate);
    for (let j = 0; j < 1200 && at + j < samples.length; j++) samples[at + j] = Math.round(20000 * Math.sin((j / rate) * 2 * Math.PI * 60) * Math.exp(-j / 500));
  }
  const { beats, bpm } = beatsFromSamples(samples, rate);
  assert.ok(Math.abs(bpm - 120) <= 1, `bpm ${bpm}`);
  assert.ok(Math.abs(beats[0] - 0.25) < 0.03, `first beat ${beats[0]}`);
  const cuts = cutPoints(beats, 6);
  assert.equal(cuts[0], 0);
  assert.equal(cuts[cuts.length - 1], 6);
  for (let i = 1; i < cuts.length - 1; i++) assert.ok(beats.some((beat) => Math.abs(beat - cuts[i]) < 0.001));
  assert.ok(cuts.slice(1).every((cut, i) => cut - cuts[i] >= 0.8 || i === cuts.length - 2));
});
