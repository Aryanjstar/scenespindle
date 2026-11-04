import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { chromium, expect } from '@playwright/test';

const dir = await mkdtemp(join(tmpdir(), 'scenespindle-e2e-'));
const media = await mkdtemp(join(tmpdir(), 'scenespindle-media-'));
const shared = { SCENESPINDLE_TEST_VOICE: '1', STORAGE_DIR: media, VOICE_CACHE_DIR: join(media, 'cache'), RENDER_WORK_DIR: join(media, 'work'), ELEVENLABS_API_KEY: '', SARVAM_API_KEY: '', GEMINI_API_KEY: '' };
const dbName = 'scenespindle_test_' + randomUUID().replaceAll('-', '');
const origin = 'http://127.0.0.1:3221';
const dbHost = '127.0.0.1:27932';
const uri = 'mongodb://' + dbHost + '/' + dbName;
const processes = [];
let browser;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const stopped = new Promise(resolve => child.once('exit', resolve));
  processes.push({ child, stopped });
  return child;
}
try {
  const mongo = launch('mongod', ['--dbpath', dir, '--port', '27932', '--bind_ip', '127.0.0.1', '--replSet', 'journey', '--logpath', join(dir, 'mongo.log')]);
  await mongoose.connect(uri + '?directConnection=true', { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongo.exitCode, null, 'Test database failed to start');
  const options = await mongoose.connection.db.admin().command({ getCmdLineOpts: 1 });
  assert.equal(options.parsed.storage.dbPath, dir);
  await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'journey', members: [{ _id: 0, host: dbHost }] } });
  await mongoose.disconnect();
  await mongoose.connect(uri + '?replicaSet=journey');
  const app = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3221'], {
    ...process.env, MONGODB_URI: uri + '?replicaSet=journey', MONGODB_DB: dbName, APP_ORIGIN: origin,
    AUTH_TOKEN_PEPPER: randomUUID(), OWNER_EMAIL: '1280@example.invalid', ...shared,
  });
  launch(process.execPath, ['--import', 'tsx', 'worker/index.ts'], {
    ...process.env, MONGODB_URI: uri + '?replicaSet=journey', MONGODB_DB: dbName, ...shared,
  });
  for (let i = 0; i < 100; i++) {
    assert.equal(app.exitCode, null, 'Test app failed to start');
    if ((await fetch(origin + '/sign-in').catch(() => null))?.ok) break;
    await sleep(100);
  }
  browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome' });
  const projects = [];
  const errors = [];
  for (const width of [1280, 390]) {
    const email = width + '@example.invalid';
    const password = randomUUID();
    await mongoose.connection.db.collection('users').insertOne({ email, name: 'Creator ' + width, passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date() });
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/sign-in');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Enter the studio' }).click();
    await page.getByPlaceholder('A topic, in one sentence').fill('Local example ' + width);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByPlaceholder('Topic', { exact: true })).toHaveValue('Local example ' + width);
    await page.getByLabel('Title', { exact: true }).fill('Renamed ' + width);
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.getByText('Project renamed', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Audience').fill('New readers');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder('Audience')).toHaveValue('New readers');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Renamed ' + width);
    await page.getByRole('textbox', { name: 'What should this video do?' }).fill('Explain a useful idea clearly for new readers');
    await page.getByRole('textbox', { name: 'Exact script, if you have one' }).fill('Use this exact sentence.');
    await page.getByRole('button', { name: 'Refine brief' }).click();
    await expect(page.getByRole('button', { name: /Story led/ })).toBeVisible();
    await page.getByRole('button', { name: /Story led/ }).click();
    await expect(page.getByText('Direction saved.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve brief' }).click();
    await expect(page.getByText('Brief approved and saved as version 1.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Status: Approved', { exact: false })).toBeVisible();
    const approved = await mongoose.connection.db.collection('briefversions').findOne({ projectId: new mongoose.Types.ObjectId(new URL(page.url()).pathname.split('/').pop()) });
    assert.equal(approved.version, 1);
    assert.equal(approved.snapshot.selectedDirectionId, 'story');
    assert.equal(approved.snapshot.exactScript, 'Use this exact sentence.');
    assert.equal(approved.promptBundle.script.exactScript, 'Use this exact sentence.');
    assert.equal(approved.promptBundle.briefHash, approved.contentHash);
    const replay = await page.evaluate(async ({ projectId, hash }) => {
      const response = await fetch('/api/projects/' + projectId + '/brief/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, contentHash: hash }) });
      return { status: response.status, body: await response.json() };
    }, { projectId: new URL(page.url()).pathname.split('/').pop(), hash: approved.contentHash });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.briefVersionId, String(approved._id));
    const race = await page.evaluate(async projectId => {
      const route = '/api/projects/' + projectId + '/brief/refine';
      const body = { expectedRevision: 2, input: { rawRequest: 'Revise the opening of this example', directionId: 'clear' } };
      return Promise.all([fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })]).then(results => results.map(item => item.status).sort());
    }, new URL(page.url()).pathname.split('/').pop());
    assert.deepEqual(race, [200, 409]);
    assert.equal(await mongoose.connection.db.collection('briefversions').countDocuments({ projectId: approved.projectId }), 1);
    const scenes = Array.from({ length: 4 }, (_, index) => ({
      id: 's' + (index + 1), purpose: index === 0 ? 'hook' : 'explain',
      lines: [{ id: 'l1', text: 'A simple example line.' }], background: { kind: 'style' },
      layers: [{ id: 'title', component: 'text.title@1', props: { text: 'Example' }, slot: 'title' }], events: [],
    }));
    const plan = { schemaVersion: 1, mode: 'explainer', title: 'A simple example', logline: 'A short example plan.',
      language: 'en', format: '9x16', targetMs: 45000, styleId: 'chalk-and-chai@1', voiceId: 'test', scenes };
    await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
    await page.getByLabel('Import a storyboard JSON file').setInputFiles({
      name: 'authored.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)),
    });
    await page.getByRole('button', { name: 'Save edits' }).click();
    await expect(page.getByText('Storyboard saved', { exact: true })).toBeVisible();
    const projectId = new URL(page.url()).pathname.split('/').pop();
    const approvals = await page.evaluate(async id => {
      const draft = await (await fetch(`/api/projects/${id}/draft`)).json();
      const approve = () => fetch(`/api/projects/${id}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftRevision: draft.revision, planHash: draft.planHash }),
      }).then(async response => ({ status: response.status, body: await response.json() }));
      return Promise.all([approve(), approve()]);
    }, projectId);
    assert.deepEqual(approvals.map(item => item.status), [202, 202]);
    assert.equal(approvals[0].body.jobId, approvals[1].body.jobId);
    assert.equal(await mongoose.connection.db.collection('storyboards').countDocuments({ projectId: new mongoose.Types.ObjectId(projectId) }), 1);
    assert.equal(await mongoose.connection.db.collection('jobs').countDocuments({ projectId: new mongoose.Types.ObjectId(projectId), type: 'render' }), 1);
    await page.getByRole('button', { name: 'Approve and preview' }).click();
    await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
    const frame = page.locator('iframe[title="Preview"]');
    await expect(frame).toHaveAttribute('src', /api\/videos\/[a-f0-9]+\/preview/);
    await expect(page.frameLocator('iframe[title="Preview"]').locator('body')).toContainText('Example');
    projects.push({ page, id: new URL(page.url()).pathname.split('/').pop(), email, password });
  }
  // A real MP4: approve, render with the local test voice, verify files, share, revoke.
  {
    const { page, id } = projects[0];
    const other = projects[1].page;
    await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
    const unconfigured = await page.evaluate(async id => (await fetch('/api/projects/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceId: 'elevenlabs:alice' }) })).status, id);
    assert.equal(unconfigured, 422, 'An unconfigured narrator cannot be chosen');
    await page.getByLabel('Narrator').selectOption('test:tone');
    await expect(page.getByText('Narrator saved', { exact: true })).toBeVisible();
    const previewShare = await page.evaluate(async () => {
      const list = await (await fetch(location.pathname.replace('/studio/p/', '/api/projects/') + '/videos')).json();
      return (await fetch('/api/videos/' + list.items[0].id + '/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status;
    });
    assert.equal(previewShare, 422, 'A preview cannot be shared');
    await page.getByRole('button', { name: 'Approve and render film' }).click();
    await expect(page.getByText('Film ready', { exact: true }).first()).toBeVisible({ timeout: 300_000 });
    const films = await page.evaluate(async id => (await fetch('/api/projects/' + id + '/videos')).json(), id);
    const film = films.items.find(item => item.kind === 'mp4');
    assert.equal(film.state, 'ready');
    assert.equal(film.current, true);
    assert.equal(film.qa.passed, true);
    assert.ok(film.warnings.some(warning => /test tone/.test(warning)));
    const probe = await page.evaluate(async files => {
      const out = {};
      for (const [kind, url] of Object.entries(files)) out[kind] = (await fetch(url, { headers: { range: 'bytes=0-15' } })).status;
      const vtt = await (await fetch(files.vtt)).text();
      return { out, vtt: vtt.slice(0, 6) };
    }, film.files);
    assert.deepEqual(probe.out, { mp4: 206, thumb: 206, sheet: 206, srt: 206, vtt: 206 });
    assert.equal(probe.vtt, 'WEBVTT');
    assert.equal(await other.evaluate(async url => (await fetch(url)).status, film.files.mp4), 404, 'Another creator cannot read the film');
    await expect(page.locator('video[aria-label^="Film version"]')).toBeVisible();
    const again = await page.evaluate(async id => {
      const draft = await (await fetch('/api/projects/' + id + '/draft')).json();
      const response = await fetch('/api/projects/' + id + '/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draftRevision: draft.revision, planHash: draft.planHash, output: 'mp4' }) });
      return { status: response.status, body: await response.json() };
    }, id);
    assert.equal(again.status, 202);
    assert.equal(again.body.jobId, String((await mongoose.connection.db.collection('jobs').findOne({ _id: new mongoose.Types.ObjectId(again.body.jobId) })).result ? again.body.jobId : ''), 'Same plan and narrator returns the finished job, not a new render');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('button', { name: 'Make a share link' }).click();
    const shareUrl = await page.getByLabel('Share link').inputValue();
    const token = shareUrl.split('/v/')[1];
    const viewer = await browser.newPage({ viewport: { width: 390, height: 844 } });
    viewer.on('pageerror', e => errors.push(e.message));
    await viewer.goto(origin + '/v/' + token);
    await expect(viewer.locator('video')).toBeVisible();
    const pub = await viewer.evaluate(async token => {
      const meta = await (await fetch('/api/public/share/' + token)).json();
      const video = await fetch(meta.videoUrl, { headers: { range: 'bytes=0-9' } });
      const download = await fetch(meta.videoUrl + '?download=1');
      const sheet = await fetch('/api/public/share/' + token + '/file/sheet');
      return { keys: Object.keys(meta).sort(), video: video.status, download: download.status, sheet: sheet.status };
    }, token);
    assert.deepEqual(pub.keys, ['allowDownload', 'captionsUrl', 'durationMs', 'format', 'posterUrl', 'title', 'videoUrl']);
    assert.deepEqual([pub.video, pub.download, pub.sheet], [206, 403, 404]);
    await page.getByLabel('Let viewers download the MP4').check();
    await expect.poll(() => viewer.evaluate(async token => (await fetch('/api/public/share/' + token + '/file/mp4?download=1', { headers: { range: 'bytes=0-1' } })).status, token)).toBe(206);
    await page.getByRole('button', { name: 'Revoke link' }).click();
    await expect(page.getByText('Link revoked. It no longer opens.')).toBeVisible();
    assert.equal(await viewer.evaluate(async token => (await fetch('/api/public/share/' + token)).status, token), 404);
    // Re-share, then delete the project: the share dies with it and the project disappears.
    await page.getByRole('button', { name: 'Make a share link' }).click();
    const second = (await page.getByLabel('Share link').inputValue()).split('/v/')[1];
    assert.equal(await viewer.evaluate(async token => (await fetch('/api/public/share/' + token)).status, second), 200);
    await viewer.close();
    projects[0].filmToken = second;
  }
  for (const [index, { page }] of projects.entries()) {
    const foreign = projects[1 - index].id;
    const status = id => page.evaluate(async projectId => (await fetch('/api/projects/' + projectId)).status, id);
    assert.equal(await status(projects[index].id), 200);
    assert.equal(await status(foreign), 404);
    const usage = await page.evaluate(async () => (await fetch('/api/usage')).json());
    assert.equal(usage.measured, true);
    assert.ok(usage.providers.every(provider => provider.configured === false));
    assert.equal(await page.evaluate(async id => (await fetch('/api/projects/' + id + '/brief')).status, foreign), 404);

  }
  assert.equal(await projects[1].page.evaluate(async () => (await fetch('/api/invites')).status), 403);
  const invite = await projects[0].page.evaluate(async () => {
    const response = await fetch('/api/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invited@example.invalid' }) });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(invite.status, 201);
  const invited = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await invited.goto(invite.body.url);
  await invited.getByLabel('Name').fill('Invited Creator');
  await invited.getByLabel('Password').fill('unique-test-password-345');
  await invited.getByRole('button', { name: 'Join the studio' }).click();
  await invited.waitForURL('**/studio');
  assert.equal((await invited.evaluate(async () => (await (await fetch('/api/auth/session')).json()).user.email)), 'invited@example.invalid');
  const replay = await invited.evaluate(async token => (await fetch('/api/auth/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'Replay', password: 'another-test-password-123' }) })).status, invite.body.url.split('#')[1]);
  assert.equal(replay, 400);
  const secondInvite = await projects[0].page.evaluate(async () => {
    const response = await fetch('/api/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'revoked@example.invalid' }) });
    return response.json();
  });
  assert.equal(await projects[0].page.evaluate(async id => (await fetch(`/api/invites/${id}/revoke`, { method: 'POST' })).status, secondInvite.id), 200);
  assert.equal(await invited.evaluate(async token => (await fetch('/api/auth/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'Revoked', password: 'another-test-password-123' }) })).status, secondInvite.url.split('#')[1]), 400);
  const raceInvite = await projects[0].page.evaluate(async () => {
    const response = await fetch('/api/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'race@example.invalid' }) });
    return response.json();
  });
  const race = await invited.evaluate(async token => Promise.all([0, 1].map(() => fetch('/api/auth/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: 'Race', password: 'another-test-password-123' }) }).then(response => response.status))), raceInvite.url.split('#')[1]);
  assert.deepEqual(race.sort(), [201, 400].sort());
  const projectId = new mongoose.Types.ObjectId(projects[0].id);
  const storyboard = await mongoose.connection.db.collection('storyboards').findOne({ projectId });
  const abandonedId = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection('jobs').insertOne({ _id: abandonedId, ownerId: storyboard.ownerId, projectId,
    type: 'render', state: 'running', activeSlot: true, attempts: 1, maxAttempts: 3,
    runAfter: new Date(), leaseToken: 'expired-worker', leaseExpiresAt: new Date(Date.now() - 1000),
    input: { storyboardId: storyboard._id, format: '9x16' }, stages: [] });
  let recovered;
  for (let attempt = 0; attempt < 100; attempt++) {
    recovered = await mongoose.connection.db.collection('jobs').findOne({ _id: abandonedId });
    if (recovered.state === 'succeeded') break;
    await sleep(100);
  }
  assert.equal(recovered.state, 'succeeded', 'Expired worker lease should be reclaimed');
  assert.equal(recovered.attempts, 2);
  assert.equal(await mongoose.connection.db.collection('videos').countDocuments({ jobId: abandonedId }), 1);
  const cancelledId = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection('jobs').insertOne({ _id: cancelledId, ownerId: storyboard.ownerId, projectId,
    type: 'render', state: 'running', activeSlot: true, attempts: 1, maxAttempts: 3,
    runAfter: new Date(), leaseToken: 'old-worker', leaseExpiresAt: new Date(Date.now() + 60_000),
    input: { storyboardId: storyboard._id, format: '9x16' }, stages: [] });
  const changeJob = (page, action) => page.evaluate(async ({ id, action }) => {
    const response = await fetch(`/api/jobs/${id}/${action}`, { method: 'POST' });
    return response.status;
  }, { id: String(cancelledId), action });
  assert.equal(await changeJob(projects[1].page, 'cancel'), 404);
  assert.equal(await changeJob(projects[0].page, 'cancel'), 200);
  const cancelled = await mongoose.connection.db.collection('jobs').findOne({ _id: cancelledId });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.leaseToken, undefined);
  assert.equal(await changeJob(projects[1].page, 'retry'), 404);
  assert.equal(await changeJob(projects[0].page, 'retry'), 202);
  let retried;
  for (let attempt = 0; attempt < 100; attempt++) {
    retried = await mongoose.connection.db.collection('jobs').findOne({ _id: cancelledId });
    if (retried.state === 'succeeded') break;
    await sleep(100);
  }
  assert.equal(retried.state, 'succeeded');
  assert.equal(await mongoose.connection.db.collection('videos').countDocuments({ jobId: cancelledId }), 1);
  // Password reset by owner link: one use, old sessions end.
  assert.equal(await invited.evaluate(async () => (await fetch('/api/resets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '390@example.invalid' }) })).status), 403);
  const before = await browser.newPage();
  await before.goto(origin + '/sign-in');
  assert.equal(await before.evaluate(async () => (await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invited@example.invalid', password: 'unique-test-password-345' }) })).status), 200);
  const reset = await projects[0].page.evaluate(async () => (await fetch('/api/resets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invited@example.invalid' }) })).json());
  const resetPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await resetPage.goto(reset.url);
  await resetPage.getByLabel('New password').fill('fresh-reset-password-789');
  await resetPage.getByRole('button', { name: 'Save password' }).click();
  await resetPage.waitForURL('**/studio');
  assert.equal(await before.evaluate(async () => (await fetch('/api/auth/session')).status), 401, 'Reset ends earlier sessions');
  await before.close();
  assert.equal(await resetPage.evaluate(async token => (await fetch('/api/auth/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'another-reset-password-1' }) })).status, reset.url.split('#')[1]), 400, 'Reset links work once');
  const requested = await resetPage.evaluate(async () => (await fetch('/api/auth/reset-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.invalid' }) })).json());
  assert.equal(requested.delivery, 'owner');
  await resetPage.close();
  // Sign-in is rate limited per address.
  const limited = await invited.evaluate(async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'limit@example.invalid', password: 'wrong-password-' + i }) })).status);
    return statuses;
  });
  assert.deepEqual(limited, [...Array(10).fill(401), 429]);
  // Soft delete hides the project, revokes its shares and keeps the data for recovery.
  const owner = projects[0].page;
  assert.equal(await owner.evaluate(async id => (await fetch('/api/projects/' + id, { method: 'DELETE' })).status, projects[0].id), 204);
  assert.equal(await owner.evaluate(async id => (await fetch('/api/projects/' + id)).status, projects[0].id), 404);
  assert.equal(await owner.evaluate(async token => (await fetch('/api/public/share/' + token)).status, projects[0].filmToken), 404);
  assert.ok(await mongoose.connection.db.collection('projects').findOne({ _id: projectId, deletedAt: { $exists: true } }));
  assert.deepEqual(errors, []);
  console.log('PASS: two creator sign-ins, desktop and phone create/save/reload, foreign project denial');
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
