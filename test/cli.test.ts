import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('doctor reports missing executables without exposing environment secrets', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/studio.ts', 'doctor'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', GEMINI_API_KEY: 'private-test-value' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /private-test-value/);
  const output = JSON.parse(result.stdout);
  assert.equal(typeof output.node.supported, 'boolean');
  assert.deepEqual(output.tools, { python3: false, ffmpeg: false, ffprobe: false, mongod: false });
});
