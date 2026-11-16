import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('CLI exports a portable silent preview without keys, and refuses overwriting inputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-cli-'));
  try {
    const input = join(dir, 'plan.json');
    const output = join(dir, 'preview.html');
    const plan = { schemaVersion: 1, mode: 'explainer', title: 'Preview example', logline: 'A simple example.', language: 'en', format: '9x16', targetMs: 45000, styleId: 'chalk-and-chai@1', voiceId: 'test', scenes: Array.from({ length: 4 }, (_, i) => ({ id: `s${i + 1}`, purpose: i ? 'explain' : 'hook', lines: [{ id: 'l1', text: 'A simple example line.' }], background: { kind: 'style' }, layers: [{ id: 'title', component: 'text.title@1', props: { text: 'Example' }, slot: 'title' }], events: [] })) };
    await writeFile(input, JSON.stringify(plan));
    const run = (target: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/studio.ts', 'preview', input, '--output', target], { encoding: 'utf8' });
    const result = run(output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).kind, 'silent-preview');
    const html = await readFile(output, 'utf8');
    assert.match(html, /data:font\/woff2;base64/);
    assert.match(html, /window.previewSeek/);
    assert.doesNotMatch(html, /src="(?:assets\/gsap|https?:)/);
    assert.notEqual(run(input).status, 0);
    assert.deepEqual(JSON.parse(await readFile(input, 'utf8')), plan);
    assert.notEqual(run(output).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
