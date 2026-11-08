import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/config/env.js';

test('environment variables take precedence over local file values, including an explicit empty value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scenespindle-env-'));
  const oldGemini = process.env.GEMINI_API_KEY;
  const oldSarvam = process.env.SARVAM_API_KEY;
  const oldEleven = process.env.ELEVENLABS_API_KEY;
  try {
    await writeFile(join(dir, '.env.local'), 'GEMINI_API_KEY=file-value\nSARVAM_API_KEY=file-speech\nELEVENLABS_API_KEY=file-voice\n');
    process.env.GEMINI_API_KEY = 'process-value';
    process.env.SARVAM_API_KEY = '';
    delete process.env.ELEVENLABS_API_KEY;
    assert.deepEqual(loadEnv(dir), { geminiApiKey: 'process-value', sarvamApiKey: '', elevenLabsApiKey: 'file-voice', azureSpeechKey: '', azureSpeechRegion: 'eastus2' });
  } finally {
    for (const [key, value] of Object.entries({ GEMINI_API_KEY: oldGemini, SARVAM_API_KEY: oldSarvam, ELEVENLABS_API_KEY: oldEleven })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
