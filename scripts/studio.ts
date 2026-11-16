import { previewHtml } from '../src/compiler/preview.js';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { planSchema, validatePlan } from '../src/contracts/plan.js';
import { groupCaptions } from '../src/cli/captions.js';
import { briefContextSchema, briefInputSchema, refineBrief } from '../src/brief/contract.js';

function commandAvailable(command: string, versionFlag = '--version'): boolean {
  return spawnSync(command, [versionFlag], { stdio: 'ignore', timeout: 5000 }).status === 0;
}

async function main(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case 'doctor':
      return {
        node: { version: process.version, supported: Number(process.versions.node.split('.')[0]) >= 22 },
        tools: { python3: commandAvailable('python3'), ffmpeg: commandAvailable('ffmpeg', '-version'), ffprobe: commandAvailable('ffprobe', '-version') },
        note: 'Offline executable checks only; MongoDB, providers and rendering are not verified.',
      };
    case 'capabilities':
      return { schemaVersion: 1, modes: ['explainer'], languages: ['en'], formats: ['9x16'], note: 'Plan validation and timed caption grouping only; this does not certify an MP4 workflow.' };
    case 'preview': {
      if (rest.length !== 3 || rest[1] !== '--output') throw new Error('Usage: preview <plan.json> --output <preview.html>');
      const checked = validatePlan(JSON.parse(await readFile(rest[0], 'utf8')));
      if (!checked.plan) { process.exitCode = 1; return { valid: false, issues: checked.issues }; }
      if (resolve(rest[0]) === resolve(rest[2])) throw new Error('Output must differ from input');
      await writeFile(rest[2], previewHtml(checked.plan), { flag: 'wx' });
      return { output: resolve(rest[2]), kind: 'silent-preview', timing: 'estimated' };
    }
    case 'schema': return z.toJSONSchema(planSchema);
    case 'validate-plan': {
      if (rest.length !== 1) throw new Error('Usage: validate-plan <plan.json>');
      const result = validatePlan(JSON.parse(await readFile(rest[0], 'utf8')));
      if (!result.plan) { process.exitCode = 1; return { valid: false, issues: result.issues }; }
      return { valid: true, plan: result.plan };
    }
    case 'brief': {
      const [action, flag, filename] = rest;
      if (!['refine', 'answer'].includes(action) || flag !== '--input' || !filename || rest.length !== 3) {
        throw new Error('Usage: studio brief <refine|answer> --input <file.json>');
      }
      const payload = JSON.parse(await readFile(filename, 'utf8'));
      const project = briefContextSchema.parse(payload.project);
      const input = briefInputSchema.parse(payload.input);
      if (action === 'answer') {
        const choice = z.enum(['clear', 'story', 'visual']).parse(payload.choice);
        return refineBrief({ ...input, directionId: choice }, project);
      }
      return refineBrief(input, project);
    }
    case 'captions': {
      if (!rest[0]) throw new Error('Usage: captions <words.json> [--max-words N]');
      if (rest.length !== 1 && !(rest.length === 3 && rest[1] === '--max-words')) throw new Error('Usage: captions <words.json> [--max-words N]');
      return groupCaptions(JSON.parse(await readFile(rest[0], 'utf8')), rest.length === 3 ? Number(rest[2]) : 6);
    }
    default: throw new Error('Usage: studio <doctor|capabilities|schema|validate-plan|preview|captions|brief>');
  }
}
main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1; });
