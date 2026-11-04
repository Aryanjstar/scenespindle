import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmCaptions, toSrt, toVtt } from '../src/pipeline/subtitles.js';
import { estimateWords } from '../src/server/providers/voice.js';
import { keyPath, putFile, streamFile } from '../src/server/storage.js';
import { VOICES, voiceEntry, voiceUnavailable } from '../src/config/providers.js';
import { videoJson } from '../src/server/videos.js';

const timeline = {
  durationMs: 6000,
  scenes: [{ id: 's1', startMs: 320, durationMs: 5000 }],
  lines: [
    { sceneId: 's1', lineId: 'l1', text: 'Ice floats. Water sinks below it.', audioFile: 'assets/a.mp3', startMs: 320, durationMs: 2600,
      words: [
        { text: 'Ice', startMs: 0, endMs: 300 }, { text: 'floats.', startMs: 300, endMs: 800 },
        { text: 'Water', startMs: 900, endMs: 1200 }, { text: 'sinks', startMs: 1200, endMs: 1500 },
        { text: 'below', startMs: 1490, endMs: 1800 }, { text: 'it.', startMs: 1800, endMs: 2100 },
      ] },
  ],
};

test('film captions use measured times, split at sentence ends and clamp provider overlaps', () => {
  const captions = filmCaptions(timeline);
  assert.deepEqual(captions.map((c) => c.text), ['Ice floats.', 'Water sinks below it.']);
  assert.equal(captions[0].startMs, 320);
  assert.equal(captions[1].endMs, 320 + 2100);
});

test('SRT and VTT are well formed and cannot be broken by arrows or newlines in text', () => {
  const captions = [{ text: 'a --> b\nc', startMs: 3_723_004, endMs: 3_723_500, words: [] }];
  const srt = toSrt(captions);
  assert.match(srt, /^1\n01:02:03,004 --> 01:02:03,500\na -> b c\n$/);
  const vtt = toVtt(captions);
  assert.ok(vtt.startsWith('WEBVTT\n\n01:02:03.004 --> 01:02:03.500\n'));
  assert.equal(vtt.split('-->').length, 2);
});

test('estimated word times are ordered, inside the clip and cover every word', () => {
  const words = estimateWords('one two three extraordinary five', 3000);
  assert.equal(words.length, 5);
  for (let i = 0; i < words.length; i++) {
    assert.ok(words[i].endMs > words[i].startMs);
    if (i) assert.ok(words[i].startMs >= words[i - 1].endMs);
  }
  assert.ok(words[words.length - 1].endMs <= 3000);
  assert.ok(words[3].endMs - words[3].startMs > words[0].endMs - words[0].startMs);
});

test('storage keys cannot escape the storage root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-store-'));
  const previous = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  try {
    for (const bad of ['../x', 'a/../../b', '/etc/passwd', 'a//b', 'A/Upper', '', 'x'.repeat(300)]) {
      assert.throws(() => keyPath(bad), /Invalid storage key/, bad);
    }
    assert.ok(keyPath('videos/a/b/film.mp4').startsWith(dir));
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIR; else process.env.STORAGE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stored files stream with byte ranges and reject bad ranges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-store-'));
  const previous = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  try {
    const source = join(dir, 'src.bin');
    writeFileSync(source, Buffer.from('0123456789'));
    const stored = await putFile('videos/o/v/film.mp4', source);
    assert.equal(stored.bytes, 10);
    assert.equal(stored.sha256.length, 64);
    const full = streamFile('videos/o/v/film.mp4', new Request('http://x/'));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(await full.text(), '0123456789');
    const part = streamFile('videos/o/v/film.mp4', new Request('http://x/', { headers: { range: 'bytes=2-4' } }));
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(await part.text(), '234');
    const tail = streamFile('videos/o/v/film.mp4', new Request('http://x/', { headers: { range: 'bytes=-3' } }));
    assert.equal(await tail.text(), '789');
    assert.equal(streamFile('videos/o/v/film.mp4', new Request('http://x/', { headers: { range: 'bytes=20-30' } })).status, 416);
    assert.equal(streamFile('videos/o/v/film.mp4', new Request('http://x/', { headers: { range: 'items=1-2' } })).status, 416);
    assert.equal(streamFile('videos/o/v/missing.mp4', new Request('http://x/')).status, 404);
    const download = streamFile('videos/o/v/film.mp4', new Request('http://x/'), { download: 'my "film".mp4' });
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="my--film-.mp4"');
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIR; else process.env.STORAGE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('voices never fall back: unknown ids are undefined and unconfigured voices say why', () => {
  assert.equal(voiceEntry('elevenlabs:nobody'), undefined);
  const alice = voiceEntry('elevenlabs:alice')!;
  assert.match(voiceUnavailable(alice, { elevenLabsApiKey: '', sarvamApiKey: '' })!, /ElevenLabs key/);
  assert.equal(voiceUnavailable(alice, { elevenLabsApiKey: 'k', sarvamApiKey: '' }), null);
  const previous = process.env.SCENESPINDLE_TEST_VOICE;
  delete process.env.SCENESPINDLE_TEST_VOICE;
  assert.ok(voiceUnavailable(voiceEntry('test:tone')!, { elevenLabsApiKey: 'k', sarvamApiKey: 'k' }));
  if (previous !== undefined) process.env.SCENESPINDLE_TEST_VOICE = previous;
  assert.ok(VOICES.every((voice) => voice.timing === 'aligned' || voice.note.length > 0));
});

test('legacy HTML-only "ready" videos are reported as previews, never as films', () => {
  const legacy = videoJson({ _id: 'a1', version: 1, state: 'ready', mp4Path: null });
  assert.equal(legacy.state, 'preview');
  assert.equal(legacy.kind, 'preview');
  assert.equal(legacy.files, undefined);
  const film = videoJson({ _id: 'b2', version: 2, state: 'ready', kind: 'mp4', artifacts: { mp4: 'videos/x/film.mp4' } }, 'b2');
  assert.equal(film.kind, 'mp4');
  assert.equal(film.current, true);
  assert.equal(film.files?.mp4, '/api/videos/b2/file/mp4');
});
