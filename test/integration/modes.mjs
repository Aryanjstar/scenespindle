// Browser journey for the newer studio modes: settings, Audio, Code Lab, Montage,
// scene-scoped copilot, restore, and cross-creator isolation for montage inputs.
// Starts its own MongoDB replica set, app and worker. Uses the local test voice.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { chromium, expect } from '@playwright/test';

const dir = await mkdtemp(join(tmpdir(), 'scenespindle-modes-'));
const media = await mkdtemp(join(tmpdir(), 'scenespindle-modes-media-'));
const dbName = 'scenespindle_test_' + randomUUID().replaceAll('-', '');
const origin = 'http://127.0.0.1:3222';
const dbHost = '127.0.0.1:27933';
const uri = 'mongodb://' + dbHost + '/' + dbName;
const shared = { SCENESPINDLE_TEST_VOICE: '1', STORAGE_DIR: media, VOICE_CACHE_DIR: join(media, 'cache'), RENDER_WORK_DIR: join(media, 'work'), ELEVENLABS_API_KEY: '', SARVAM_API_KEY: '', GEMINI_API_KEY: '' };
const SCRIPT = readFileSync('examples/scripts/why-leaves-change-colour.txt', 'utf8').trim();
const processes = [];
let browser;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const stopped = new Promise(done => child.once('exit', done));
  processes.push({ child, stopped });
  return child;
}
const errors = [];
async function newCreator(width, label) {
  const email = label + '@example.invalid';
  const password = randomUUID();
  await mongoose.connection.db.collection('users').insertOne({ email, name: 'Creator ' + label, passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(Date.now() - 1000) });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/sign-in');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Enter the studio' }).click();
  await page.waitForURL('**/studio');
  return page;
}
async function createProject(page, mode, topic) {
  const result = await page.evaluate(async ({ mode, topic }) => {
    const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, topic, title: topic }) });
    return response.json();
  }, { mode, topic });
  await page.goto(origin + '/studio/p/' + result.project.id);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(topic);
  return result.project.id;
}
async function videos(page, id) {
  return page.evaluate(async id => (await fetch('/api/projects/' + id + '/videos')).json(), id);
}
const dims = qa => qa.checks.find(check => check.name === 'dimensions').detail;

try {
  launch('mongod', ['--dbpath', dir, '--port', '27933', '--bind_ip', '127.0.0.1', '--replSet', 'modes', '--logpath', join(dir, 'mongo.log')]);
  for (let i = 0; i < 50; i++) { try { await mongoose.connect(uri + '?directConnection=true', { serverSelectionTimeoutMS: 1000 }); break; } catch { await sleep(200); } }
  await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'modes', members: [{ _id: 0, host: dbHost }] } });
  await mongoose.disconnect();
  await mongoose.connect(uri + '?replicaSet=modes');
  const env = { ...process.env, MONGODB_URI: uri + '?replicaSet=modes', MONGODB_DB: dbName, ...shared };
  const app = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3222'], { ...env, APP_ORIGIN: origin, AUTH_TOKEN_PEPPER: randomUUID(), OWNER_EMAIL: 'owner@example.invalid' });
  launch(process.execPath, ['--import', 'tsx', 'worker/index.ts'], env);
  for (let i = 0; i < 100; i++) {
    assert.equal(app.exitCode, null, 'Test app failed to start');
    if ((await fetch(origin + '/sign-in').catch(() => null))?.ok) break;
    await sleep(100);
  }
  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome' });
  const page = await newCreator(1280, 'modes');
  const other = await newCreator(390, 'other');

  // Catalog only offers what renders.
  const catalog = await page.evaluate(async () => (await fetch('/api/catalog')).json());
  assert.deepEqual(catalog.modes.filter(mode => mode.available).map(mode => mode.id).sort(), ['audio', 'cartoon', 'code_lab', 'explainer', 'lyrics', 'montage', 'story']);

  // Audio film from an approved exact script, planned offline, rendered with the test voice.
  const audioId = await createProject(page, 'audio', 'Why leaves change colour');
  await page.getByLabel('Narrator').waitFor({ state: 'detached' }).catch(() => {});
  await page.getByRole('textbox', { name: 'Exact script, if you have one' }).fill(SCRIPT);
  await page.getByRole('button', { name: 'Refine brief' }).click();
  await page.getByRole('button', { name: /Story led/ }).click();
  await expect(page.getByText('Direction saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve brief' }).click();
  await expect(page.getByText('Brief approved and saved as version 1.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Plan storyboard' }).click();
  await expect(page.getByText('Storyboard ready', { exact: true })).toBeVisible({ timeout: 30_000 });
  const audioDraft = await page.evaluate(async id => (await fetch('/api/projects/' + id + '/draft')).json(), audioId);
  assert.equal(audioDraft.plan.mode, 'audio');
  assert.equal(audioDraft.plan.scenes.map(scene => scene.lines[0].text).join(' '), SCRIPT.replace(/\s+/g, ' '), 'Exact script kept verbatim');
  await page.getByLabel('Narrator').selectOption('test:tone');
  await expect(page.getByText('Narrator saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and render film' }).click();
  await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });
  const audioFilm = (await videos(page, audioId)).items[0];
  assert.equal(audioFilm.state, 'ready');
  assert.equal(dims(audioFilm.qa), '1080x1920');

  // Scene-scoped copilot: only the ticked scene changes.
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  await page.getByLabel('Ask the copilot about s2').check();
  await page.getByLabel('Message to the copilot').fill('Make it faster');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.getByText('Change kept', { exact: true })).toBeVisible();
  const paced = await page.evaluate(async id => (await fetch('/api/projects/' + id + '/draft')).json(), audioId);
  assert.ok(paced.plan.scenes[1].holdMs < audioDraft.plan.scenes[1].holdMs, 's2 got faster');
  for (const index of [0, 2, 3, 4]) assert.deepEqual(paced.plan.scenes[index], audioDraft.plan.scenes[index], 'other scenes unchanged');

  // Code Lab: browser trace, offline plan from the trace, square film.
  const codeId = await createProject(page, 'code_lab', 'How binary search finds 21');
  await page.getByLabel('Format').selectOption('1x1');
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByText(/calls, depth/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Plan storyboard' }).click();
  await expect(page.getByText('Storyboard ready', { exact: true })).toBeVisible({ timeout: 30_000 });
  const codeDraft = await page.evaluate(async id => (await fetch('/api/projects/' + id + '/draft')).json(), codeId);
  assert.equal(codeDraft.plan.mode, 'code_lab');
  assert.equal(codeDraft.plan.format, '1x1');
  assert.ok(codeDraft.plan.scenes.some(scene => scene.layers.some(layer => layer.component === 'trace.array@1')));
  assert.equal(codeDraft.plan.scenes[4].layers.find(layer => layer.component === 'text.slam@1').props.text, '3', 'Answer comes from the run');
  await page.getByLabel('Narrator').selectOption('test:tone');
  await expect(page.getByText('Narrator saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and render film' }).click();
  await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });
  const codeFilm = (await videos(page, codeId)).items[0];
  assert.equal(codeFilm.state, 'ready');
  assert.equal(dims(codeFilm.qa), '1080x1080');

  // Montage: upload generated demo media, cut on beats, landscape.
  const montageId = await createProject(page, 'montage', 'Demo montage');
  await page.getByLabel('Format').selectOption('16x9');
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  const files = ['clip-testcard.mp4', 'photo-gradient-a.png', 'clip-mandelbrot.mp4', 'photo-gradient-b.jpg', 'music-120bpm.mp3'].map(name => resolve('examples/media', name));
  await page.getByLabel(/Upload photos, clips or music/).setInputFiles(files);
  await expect(page.getByText('Photos and clips · 4 picked')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Music music-120bpm.mp3')).toBeChecked();
  await page.getByLabel('Montage length').selectOption('10');
  await page.getByRole('button', { name: 'Render montage' }).click();
  await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });
  const montage = (await videos(page, montageId)).items[0];
  assert.equal(montage.state, 'ready');
  assert.equal(dims(montage.qa), '1920x1080');
  assert.equal(montage.files.vtt, undefined, 'Montages have no captions');
  assert.ok(montage.warnings.some(warning => /120 BPM/.test(warning)));

  // Another creator cannot use these clips or this project.
  const mine = await page.evaluate(async () => (await (await fetch('/api/library/assets')).json()).items.filter(item => item.mine).map(item => item.id));
  const otherMontage = await other.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'montage', topic: 'theft' }) })).json()).project.id);
  assert.equal(await other.evaluate(async ({ id, assets }) => (await fetch('/api/projects/' + id + '/montage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetIds: assets }) })).status, { id: otherMontage, assets: mine.slice(0, 1) }), 404);
  assert.equal(await other.evaluate(async id => (await fetch('/api/projects/' + id + '/montage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetIds: ['0123456789abcdef01234567'] }) })).status, montageId), 404);
  assert.equal(await other.evaluate(async url => (await fetch(url)).status, montage.files.mp4), 404);
  const upload = await other.evaluate(async () => {
    const form = new FormData();
    form.set('file', new File(['<html>not a video</html>'], 'fake.mp4', { type: 'video/mp4' }));
    return (await fetch('/api/library/assets', { method: 'POST', body: form })).status;
  });
  assert.equal(upload, 415, 'Uploads are checked by content, not the declared type');

  // Story performs on the 3D stage. Offline planning needs an exact script.
  const storyId = await createProject(page, 'story', 'Paper boat');
  await expect(page.getByRole('heading', { name: 'Who performs' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Exact script, if you have one' }).fill('Meera walks to the river. She waves at the boat. She turns toward home.');
  await page.getByRole('button', { name: 'Refine brief' }).click();
  await page.getByRole('button', { name: /Story led/ }).click();
  await page.getByRole('button', { name: 'Approve brief' }).click();
  await page.getByRole('button', { name: 'Plan storyboard' }).click();
  await expect(page.getByText('Storyboard ready', { exact: true })).toBeVisible({ timeout: 30_000 });
  const storyDraft = await page.evaluate(async id => (await fetch('/api/projects/' + id + '/draft')).json(), storyId);
  assert.ok(storyDraft.plan.scenes.every(scene => scene.layers.some(layer => layer.component === 'stage.perform@1')));
  await page.getByLabel('Narrator').selectOption('test:tone');
  await page.getByRole('button', { name: 'Approve and render film' }).click();
  await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });

  const lyricsId = await createProject(page, 'lyrics', 'Spin the spindle');
  await expect(page.getByLabel('Timed lyrics')).toBeVisible();
  assert.equal(lyricsId.length, 24);

  await page.goto(origin + '/studio/settings');
  await page.getByLabel('Token name').fill('e2e');
  await page.getByRole('button', { name: 'Create token' }).click();
  const minted = await page.getByLabel('New token').inputValue();
  assert.match(minted, /^ss_/);

  // Delete and restore from the projects page.
  await page.goto(origin + '/studio');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Demo montage' }).click();
  await expect(page.getByRole('link', { name: 'Demo montage', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recently deleted' }).click();
  await page.getByRole('region', { name: 'Recently deleted' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('link', { name: 'Demo montage', exact: true })).toBeVisible();
  assert.equal((await videos(page, montageId)).items.length, 1, 'Restored project keeps its film');

  // Phone width: no horizontal overflow on any workspace step.
  await other.goto(origin + '/studio/p/' + otherMontage);
  for (const name of ['Idea', 'Storyboard', 'Film', 'Share']) {
    await other.getByRole('button', { name, exact: true }).click();
    assert.equal(await other.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no overflow on ' + name);
  }

  assert.deepEqual(errors, []);
  console.log('PASS: audio, code lab, montage, story stage, lyrics, tokens, restore, isolation');
} finally {
  await browser?.close();
  await mongoose.disconnect();
  for (const { child, stopped } of processes.reverse()) {
    child.kill('SIGTERM');
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
  await rm(media, { recursive: true, force: true });
}
