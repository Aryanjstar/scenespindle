// Browser journey for the studio screens added in v4: library, characters, styles, series,
// tools, queue, settings (password, sessions, paired PCs), reel captions, exports, versions,
// the command palette, and phone width on every page. Own MongoDB, app and worker; test voice.
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

const dir = await mkdtemp(join(tmpdir(), 'scenespindle-screens-'));
const media = await mkdtemp(join(tmpdir(), 'scenespindle-screens-media-'));
const dbName = 'scenespindle_test_' + randomUUID().replaceAll('-', '');
const origin = 'http://127.0.0.1:3223';
const dbHost = '127.0.0.1:27934';
const uri = 'mongodb://' + dbHost + '/' + dbName;
const shared = { SCENESPINDLE_TEST_VOICE: '1', STORAGE_DIR: media, VOICE_CACHE_DIR: join(media, 'cache'), RENDER_WORK_DIR: join(media, 'work'), ELEVENLABS_API_KEY: '', SARVAM_API_KEY: '', GEMINI_API_KEY: '' };
const processes = [];
let browser;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const stopped = new Promise(done => child.once('exit', done));
  processes.push({ child, stopped });
  return child;
}
const errors = [];
const passwords = {};
async function newCreator(width, label, existing = false) {
  const email = label + '@example.invalid';
  const password = existing ? passwords[label] : randomUUID();
  if (!existing) {
    passwords[label] = password;
    await mongoose.connection.db.collection('users').insertOne({ email, name: 'Creator ' + label, passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(Date.now() - 1000) });
  }
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/sign-in');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Enter the studio' }).click();
  await page.waitForURL('**/studio');
  page.__password = password;
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
  launch('mongod', ['--dbpath', dir, '--port', '27934', '--bind_ip', '127.0.0.1', '--replSet', 'screens', '--logpath', join(dir, 'mongo.log')]);
  for (let i = 0; i < 50; i++) { try { await mongoose.connect(uri + '?directConnection=true', { serverSelectionTimeoutMS: 1000 }); break; } catch { await sleep(200); } }
  await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'screens', members: [{ _id: 0, host: dbHost }] } });
  await mongoose.disconnect();
  await mongoose.connect(uri + '?replicaSet=screens');
  const env = { ...process.env, MONGODB_URI: uri + '?replicaSet=screens', MONGODB_DB: dbName, ...shared };
  const app = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3223'], { ...env, APP_ORIGIN: origin, AUTH_TOKEN_PEPPER: randomUUID(), OWNER_EMAIL: 'screens@example.invalid' });
  launch(process.execPath, ['--import', 'tsx', 'worker/index.ts'], env);
  for (let i = 0; i < 100; i++) {
    assert.equal(app.exitCode, null, 'Test app failed to start');
    if ((await fetch(origin + '/sign-in').catch(() => null))?.ok) break;
    await sleep(100);
  }
  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome' });
  const page = await newCreator(1280, 'screens');
  const other = await newCreator(390, 'phone');
  page.on('dialog', dialog => dialog.accept());
  other.on('dialog', dialog => dialog.accept());
  const json = (p, path, method = 'GET', body) => p.evaluate(async ({ path, method, body }) => { const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, { path, method, body });
  const waitJob = async (p, id) => { for (let i = 0; i < 400; i++) { const j = await json(p, '/api/jobs/' + id); if (!['queued', 'running'].includes(j.body.state)) return j.body; await sleep(750); } throw new Error('job timeout'); };

  // Library: upload through the page, then delete a file nothing uses.
  await page.goto(origin + '/studio/library');
  await page.locator('label:has-text("Upload files") input[type=file]').setInputFiles([resolve('examples/media/photo-gradient-a.png'), resolve('examples/media/clip-testcard.mp4')]);
  await expect(page.locator('.char-card')).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.locator('.char-card')).toHaveCount(1, { timeout: 10_000 });

  // Characters: an original character with a stage look; a famous name is refused.
  await page.getByRole('tab', { name: 'Characters' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Asha');
  await page.getByLabel('Hair', { exact: true }).selectOption('bun');
  await page.getByLabel('Outfit').selectOption('saree');
  await page.getByRole('button', { name: 'Add character' }).click();
  await expect(page.getByText('Asha added.', { exact: true })).toBeVisible();
  const chars = await json(page, '/api/characters');
  assert.equal(chars.body.items[0].look.outfit, 'saree');
  assert.equal((await json(page, '/api/characters', 'POST', { name: 'Mickey Mouse', draw: false })).status, 422);
  assert.equal((await json(other, '/api/characters/' + chars.body.items[0].id)).status, 404, 'Characters are private');

  // Styles: learn a style from a reference clip in the worker.
  await page.getByRole('tab', { name: 'Styles' }).click();
  await page.getByLabel('Style name').fill('Test card style');
  await page.locator('label:has-text("Upload reels") input[type=file]').setInputFiles(resolve('examples/media/clip-mandelbrot.mp4'));
  await expect(page.getByRole('button', { name: /mandelbrot/, pressed: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Learn this style' }).click();
  await expect(page.getByText('Style learned. Pick it in any Montage.')).toBeVisible({ timeout: 120_000 });

  // Series: create, edit, approve (saving first), make an episode that freezes the version.
  await page.goto(origin + '/studio/series');
  await page.getByLabel('Title', { exact: true }).fill('Tikku town');
  await page.getByRole('button', { name: 'Create series' }).click();
  await page.waitForURL('**/studio/series/*');
  await page.getByLabel('World', { exact: true }).fill('A small hill town with a market');
  await page.getByLabel('Continuity notes').fill('The kite was mended in episode 1');
  await page.getByRole('button', { name: 'Save and approve version' }).click();
  await expect(page.getByText(/Version 1 approved/)).toBeVisible();
  await page.getByLabel('Next episode').fill('Tikku visits the market');
  await page.getByRole('button', { name: 'New episode' }).click();
  await page.waitForURL('**/studio/p/*');
  const episode = new URL(page.url()).pathname.split('/').pop();
  const ep = await json(page, '/api/projects/' + episode);
  assert.equal(ep.body.project.seriesVersion, 1);
  assert.equal(ep.body.project.episodeNumber, 1);
  await expect(page.getByText(/Episode 1 of/)).toBeVisible();

  // Reel captions from pasted SRT become a versioned, shareable film.
  const reel = (await json(page, '/api/projects', 'POST', { mode: 'reel', title: 'My reel' })).body.project.id;
  await page.goto(origin + '/studio/p/' + reel);
  await page.locator('label:has-text("Upload reel") input[type=file]').setInputFiles(resolve('examples/media/clip-testcard.mp4'));
  await expect(page.getByRole('button', { name: /clip-testcard/, pressed: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('radio', { name: 'I will paste captions' }).click();
  await page.getByLabel('Captions: SRT, LRC, or plain lines').fill('1\n00:00:00,200 --> 00:00:01,500\nHello there\n\n2\n00:00:01,600 --> 00:00:03,000\nThis is a test');
  await page.getByRole('radio', { name: 'Bottom' }).click();
  await page.getByRole('button', { name: 'Caption my reel' }).click();
  await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });
  const reelVideos = await json(page, '/api/projects/' + reel + '/videos');
  assert.equal(reelVideos.body.items[0].state, 'ready');

  // Karaoke: times are optional. A finished caption opens the Film step, so go back to the reel
  // form. When the studio can listen, an empty box still enables the button. Otherwise the words
  // are required, and a plain line (no [mm:ss]) is enough.
  const canListen = Boolean((await json(page, '/api/catalog')).body.captions?.transcription);
  await page.getByRole('button', { name: 'Reel', exact: true }).click();
  await page.getByRole('radio', { name: 'Karaoke lyrics (singing)' }).click();
  const lyricButton = page.getByRole('button', { name: 'Make my lyric video' });
  await page.getByLabel('Lyrics').fill('');
  if (canListen) await expect(lyricButton).toBeEnabled();
  else await expect(lyricButton).toBeDisabled();
  await page.getByLabel('Lyrics').fill('kuch bhi nahin hai ye jahaan');
  await expect(lyricButton).toBeEnabled();
  await page.getByLabel('Lyrics').fill('');
  if (canListen) await expect(lyricButton).toBeEnabled();
  else await expect(lyricButton).toBeDisabled();
  await page.getByRole('radio', { name: 'Phrases' }).click();

  // Exports: package and OTIO are made in the worker and downloadable by the owner only.
  const vid = reelVideos.body.items[0].id;
  for (const kind of ['otio', 'package', 'audio']) {
    const start = await json(page, '/api/videos/' + vid + '/exports', 'POST', { kind });
    assert.equal(start.status, 202);
    const done = await waitJob(page, start.body.jobId);
    assert.equal(done.state, 'succeeded', kind);
    assert.equal(await page.evaluate(async url => (await fetch(url)).status, done.result.url), 200);
    assert.equal(await other.evaluate(async url => (await fetch(url)).status, done.result.url), 404);
  }

  // Tools: banner PNG with safe-area guides, drawn in the worker.
  await page.goto(origin + '/studio/tools');
  await page.getByLabel('Headline', { exact: true }).fill('I make films that teach');
  await page.getByRole('button', { name: 'Draw banner' }).click();
  await expect(page.getByAltText('Your banner', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByAltText('Your banner with safe areas marked')).toBeVisible();

  // Queue lists the jobs above.
  await page.goto(origin + '/studio/queue');
  await expect(page.getByText('Banner', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Reel captions', { exact: true }).first()).toBeVisible();

  // Settings: pair a PC, see sessions, change password (other sessions end).
  await page.goto(origin + '/studio/settings');
  await page.getByLabel('PC name').fill('Test PC');
  await page.getByRole('button', { name: 'Pair a PC' }).click();
  const pairLine = await page.getByLabel('Link').first().inputValue();
  const code = pairLine.match(/pair (\w{10})/)[1];
  const paired = await fetch(origin + '/api/agents/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, capabilities: { ffmpeg: true } }) }).then(r => r.json());
  assert.match(paired.token, /^sa_/);
  assert.equal((await fetch(origin + '/api/agents/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })).status, 404, 'A pairing code works once');
  assert.equal((await fetch(origin + '/api/agents/claim', { method: 'POST', headers: { authorization: 'Bearer ' + paired.token } })).status, 204);
  await page.reload();
  await page.getByRole('button', { name: 'Unpair' }).click();
  await expect(page.getByRole('button', { name: 'Unpair' })).toHaveCount(0);
  assert.equal((await fetch(origin + '/api/agents/claim', { method: 'POST', headers: { authorization: 'Bearer ' + paired.token } })).status, 401, 'An unpaired PC cannot claim');
  const second = await newCreator(1280, 'screens', true);
  await page.getByLabel('Current password').fill(page.__password);
  await page.getByLabel('New password (12 or more characters)').fill('a-brand-new-password-42');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Other browsers were signed out.')).toBeVisible();
  assert.equal(await second.evaluate(async () => (await fetch('/api/auth/session')).status), 401);
  const allowances = await json(page, '/api/usage/allowances');
  assert.equal(allowances.status, 200);
  assert.equal((await json(other, '/api/usage/allowances')).status, 403, 'Only the owner sets allowances');

  // Command palette opens with the keyboard and jumps to a page.
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search commands').fill('Go to Library');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/studio/library');

  // Phone width: no sideways scroll on any studio page.
  for (const path of ['/studio', '/studio/library', '/studio/library?tab=characters', '/studio/library?tab=styles', '/studio/series', '/studio/tools', '/studio/queue', '/studio/settings']) {
    await other.goto(origin + path);
    await other.waitForLoadState('networkidle');
    assert.equal(await other.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no overflow on ' + path);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: library, characters, styles, series, reel captions, exports, tools, queue, settings, agents, palette, phone width');
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
