import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { otioJson, toOtio, writeZip } from '../src/pipeline/exports';
import { jsToPython } from '../src/trace/js';
import { traceProgram } from '../src/trace/interpret';
import { describeRun, keyStates } from '../src/trace/states';
import { cutPoints } from '../src/pipeline/montage';
import { overlayTimeline, sfxCues } from '../src/compiler/montage-overlay';
import { montageSettingsSchema, montageStyle, resolveMontage } from '../src/catalog/montage-styles';
import { learnedStyle, pacingFor } from '../src/server/style-analysis';
import { clientIp } from '../src/server/rate-limit';
import { cleanLook } from '../src/compiler/stage';
import { signAssetUrl, verifyAssetSignature, signPreviewImages } from '../src/server/signed';
import { cuesFromWords } from '../src/pipeline/caption-reel';


test('OTIO export writes doubles and the scene ranges of the film', () => {
  const text = otioJson(toOtio('Film', { durationMs: 2000, scenes: [{ id: 's1', startMs: 0, durationMs: 1000 }, { id: 's2', startMs: 1000, durationMs: 1000 }], lines: [{ sceneId: 's1', lineId: 'l1', text: 'Hi', startMs: 100, durationMs: 500 }] }));
  assert.match(text, /"rate": 30\.0/);
  assert.doesNotMatch(text, /"rate": 30[,\n]/);
  const parsed = JSON.parse(text);
  assert.equal(parsed.tracks.children[0].children.length, 2);
  assert.equal(parsed.tracks.children[0].markers[0].name, 'Hi');
});

test('the zip writer makes an archive unzip can list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-zip-'));
  const out = join(dir, 'p.zip');
  writeZip(out, [{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.json', data: '{}' }]);
  const listing = execFileSync('unzip', ['-l', out], { encoding: 'utf8' });
  assert.match(listing, /a\.txt/);
  assert.match(listing, /dir\/b\.json/);
  assert.equal(readFileSync(out).subarray(0, 4).toString('hex'), '504b0304');
});

test('JavaScript traces run on the same tracer and map back to JavaScript lines', () => {
  const js = 'function sum(arr) {\n  let total = 0;\n  for (let i = 0; i < arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}';
  const { python, lineMap } = jsToPython(js);
  const result = traceProgram(python, 'sum', [[1, 2, 3]]);
  assert.equal(result.returned, 6);
  assert.ok(lineMap.every((n) => n >= 1 && n <= 7));
  assert.throws(() => jsToPython('function f() { return fetch(1); }'), /not allowed/);
  assert.throws(() => jsToPython('let x = 1;'), /outside a function/);
});

test('Python tracer handles elif chains, for range, modulo and not-equal', () => {
  const py = 'def c(n):\n    if n % 15 == 0:\n        return 15\n    elif n % 5 == 0:\n        return 5\n    elif n != 3:\n        return 1\n    else:\n        return 3\n\ndef t(k):\n    s = 0\n    for i in range(1, k):\n        s += i\n    return s\n';
  assert.deepEqual([30, 10, 7, 3].map((n) => traceProgram(py, 'c', [n]).returned), [15, 5, 1, 3]);
  assert.equal(traceProgram(py, 't', [5]).returned, 10);
});

test('trace narration credits a change to the line that made it', () => {
  const py = 'def f(n):\n    a = n + 1\n    b = a * 2\n    return b\n';
  const result = traceProgram(py, 'f', [3]);
  const facts = describeRun('f', [3], keyStates(result.steps), result.returned).join(' ');
  assert.match(facts, /After line 2 runs: n=3, a=4/);
  assert.match(facts, /After line 3 runs: n=3, a=4, b=8/);
});

test('montage pacing: beat and half-beat cut faster and respect the shortest shot', () => {
  const beats = Array.from({ length: 40 }, (_, i) => Number((i * 0.5).toFixed(3)));
  const two = cutPoints(beats, 10, 1.6, 'two-beats', 0.8);
  const one = cutPoints(beats, 10, 1.6, 'beat', 0.35);
  const half = cutPoints(beats, 10, 1.6, 'half-beat', 0.2);
  assert.ok(two.length < one.length && one.length < half.length);
  for (let i = 1; i < half.length - 1; i++) assert.ok(half[i] - half[i - 1] >= 0.2 - 1e-9);
  assert.equal(half.at(-1), 10);
});

test('vlog overlay places chapters on cuts and a sound on each cut', () => {
  const cuts = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 8];
  const t = overlayTimeline(8, cuts, 3);
  assert.equal(t.spans.length, 3);
  assert.ok(t.spans.every((s) => cuts.includes(s.start)));
  const cues = sfxCues({ format: '9x16', seconds: 8, style: montageStyle('vlog-day@1'), settings: { kicker: '', title: 'day', subtitle: '', chapters: [{ time: '', label: 'a' }, { time: '', label: 'b' }, { time: '', label: 'c' }], outro: 'Good Night', outroSub: '' }, cuts, music: null });
  assert.ok(cues.some((c) => c.kind === 'swish') && cues.some((c) => c.kind === 'chime'));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].at - cues[i - 1].at >= 0.12 - 1e-9);
  assert.equal(sfxCues({ format: '9x16', seconds: 8, style: montageStyle('beat-cut@1'), settings: { kicker: '', title: '', subtitle: '', chapters: [], outro: '', outroSub: '' }, cuts, music: null }).length, 0);
});

test('montage settings refuse markup and creator overrides beat the style', () => {
  assert.equal(montageSettingsSchema.safeParse({ title: '<script>' }).success, false);
  assert.equal(montageSettingsSchema.safeParse({ title: 'a — b' }).success, false);
  const style = resolveMontage({ styleId: 'vlog-day@1', pacing: 'two-beats', accent: '#123456', displayFont: 'pinyon' });
  assert.equal(style.pacing, 'two-beats');
  assert.equal(style.palette.accent, '#123456');
  assert.equal(style.fonts.display, 'pinyon');
  assert.equal(learnedStyle({ base: 'nope' }), null);
  assert.equal(pacingFor(0.4).pacing, 'half-beat');
  assert.equal(pacingFor(2.5).pacing, 'two-beats');
});

test('client IP trusts only the proxy hop, never a client-supplied first entry', () => {
  const request = new Request('http://x', { headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' } });
  assert.equal(clientIp(request, 1), '9.9.9.9');
  assert.equal(clientIp(request, 0), 'local');
});

test('stage looks drop anything that is not a registered value', () => {
  const look = cleanLook({ skin: 'red;} body{', hairStyle: 'mohawk', outfit: 'saree', top: '#ABCDEF' }, 0);
  assert.match(look.skin, /^#[0-9a-f]{6}$/);
  assert.notEqual(look.hairStyle, 'mohawk');
  assert.equal(look.outfit, 'saree');
  assert.equal(look.top, '#abcdef');
});

test('signed asset links verify only for their id, scope and time', () => {
  const id = 'a'.repeat(24);
  const url = new URL('http://x' + signAssetUrl(id, 60));
  assert.equal(verifyAssetSignature(id, url.searchParams.get('exp'), url.searchParams.get('sig'), url.searchParams.get('scope')), 'preview');
  assert.equal(verifyAssetSignature('b'.repeat(24), url.searchParams.get('exp'), url.searchParams.get('sig'), 'preview'), null);
  assert.equal(verifyAssetSignature(id, url.searchParams.get('exp'), url.searchParams.get('sig'), 'agent'), null);
  assert.equal(verifyAssetSignature(id, '1000000000', url.searchParams.get('sig'), 'preview'), null);
  assert.match(signPreviewImages(`<img src="/api/assets/${id}/file">`), /sig=/);
});

test('punchy reel captions keep 2 to 3 words and never overlap', () => {
  const words = 'one two three four five. six seven'.split(' ').map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250 }));
  const cues = cuesFromWords(words, 'punchy');
  assert.ok(cues.every((c) => c.text.split(' ').length <= 3));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].startMs >= cues[i - 1].endMs);
});
