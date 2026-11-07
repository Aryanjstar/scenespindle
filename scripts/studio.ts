import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { planSchema, validatePlan } from '../src/contracts/plan.js';
import { groupCaptions } from '../src/cli/captions.js';
import { briefContextSchema, briefInputSchema, refineBrief } from '../src/brief/contract.js';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VOICES, voiceEntry, voiceUnavailable } from '../src/config/providers.js';
import { loadEnv } from '../src/config/env.js';
import { STAGE_ACTIONS, STAGE_SETS, STAGE_SHOTS } from '../src/compiler/stage.js';

function commandAvailable(command: string, versionFlag = '--version'): boolean {
  return spawnSync(command, [versionFlag], { stdio: 'ignore', timeout: 5000 }).status === 0;
}

async function main(args: string[]) {
  const [command, ...rest] = args;
  switch (command) {
    case 'doctor':
      return {
        node: { version: process.version, supported: Number(process.versions.node.split('.')[0]) >= 22 },
        tools: { python3: commandAvailable('python3'), ffmpeg: commandAvailable('ffmpeg', '-version'), ffprobe: commandAvailable('ffprobe', '-version'), mongod: commandAvailable('mongod') },
        note: 'Offline executable checks only. Run check-providers for keys and a test-tone render to verify the renderer.',
      };
    case 'capabilities': {
      const env = loadEnv();
      return {
        schemaVersion: 1, modes: ['explainer', 'code_lab', 'audio', 'story', 'cartoon', 'lyrics', 'montage'], languages: ['en', 'hi', 'hinglish'], formats: ['9x16', '16x9', '1x1'],
        story: { looks: ['stage', 'illustrated'], sets: STAGE_SETS, actions: STAGE_ACTIONS, shots: STAGE_SHOTS, illustratedNeeds: 'AZURE_IMAGE_ENDPOINT and AZURE_IMAGE_KEY' },
        voices: VOICES.map(voice => ({ id: voice.id, timing: voice.timing, commercial: voice.commercial, available: !voiceUnavailable(voice, env), reason: voiceUnavailable(voice, env) ?? undefined })),
        render: { renderer: 'hyperframes@0.8.176', output: 'mp4 1080x1920 30fps h264/aac, -14 LUFS, srt, vtt, thumbnail, contact sheet' },
        note: 'Explainer, Code Lab, Audio, Story, Cartoon, Lyrics and Montage render. Story and Cartoon perform on a 3D stage.',
      };
    }
    case 'trace': {
      // studio trace <code.py> --entry <fn> --input '<json array>'  (runs the same sandboxed interpreter the browser uses)
      const [file, ...flags] = rest;
      const flag = (name: string) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : undefined; };
      if (!file || !flag('--entry') || !flag('--input')) throw new Error("Usage: trace <code.py> --entry <function> --input '[args]'");
      const { traceProgram } = await import('../src/trace/interpret.js');
      const code = await readFile(file, 'utf8');
      const input = JSON.parse(flag('--input')!);
      if (!Array.isArray(input)) throw new Error('--input must be a JSON array of arguments');
      const result = traceProgram(code, flag('--entry')!, input);
      return { entry: flag('--entry'), input, code, returned: result.returned, summary: result.summary, steps: result.steps };
    }
    case 'plan': {
      // studio plan --topic "..." [--language en|hi|hinglish] [--format 9x16|16x9|1x1] [--seconds 45] [--script file] [--trace trace.json] [--offline]
      const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
      const { planProject } = await import('../src/pipeline/planner.js');
      const { keyStates } = await import('../src/trace/states.js');
      const traceFile = flag('--trace');
      const trace = traceFile ? JSON.parse(await readFile(traceFile, 'utf8')) : null;
      const env = loadEnv();
      const result = await planProject({
        topic: flag('--topic') ?? trace?.entry ?? '',
        audience: flag('--audience'),
        language: (flag('--language') ?? 'en') as 'en' | 'hi' | 'hinglish',
        format: (flag('--format') ?? '9x16') as '9x16' | '16x9' | '1x1',
        targetMs: Number(flag('--seconds') ?? 45) * 1000,
        mode: trace ? 'code_lab' : (['story', 'cartoon', 'audio'] as const).find((item) => item === flag('--mode')) ?? (rest.includes('--audio') ? 'audio' : 'explainer'),
        look: flag('--look') === 'illustrated' ? 'illustrated' : 'stage',
        voiceId: flag('--voice') ?? 'elevenlabs:alice',
        brief: flag('--script') ? { exactScript: await readFile(flag('--script')!, 'utf8') } : null,
        trace: trace ? { entry: trace.entry, input: trace.input, returned: trace.returned, code: trace.code, states: keyStates(trace.steps) } : null,
      }, { apiKey: rest.includes('--offline') ? undefined : env.geminiApiKey || undefined });
      return result.plan;
    }
    case 'montage': {
      // studio montage --clips a.mp4,b.jpg --music song.mp3 [--format 9x16] [--seconds 15] [--out dir]
      const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
      const clips = (flag('--clips') ?? '').split(',').map(item => item.trim()).filter(Boolean);
      if (!clips.length) throw new Error('Usage: montage --clips a.mp4,b.jpg [--music song.mp3] [--format 9x16|16x9|1x1] [--seconds 15] [--out dir]');
      const { renderMontage } = await import('../src/pipeline/montage.js');
      const out = resolve(flag('--out') ?? 'out/montage');
      mkdirSync(out, { recursive: true });
      const result = await renderMontage({
        clips: clips.map(file => ({ file: resolve(file), kind: /\.(png|jpe?g|webp)$/i.test(file) ? 'image' as const : 'video' as const })),
        music: flag('--music') ? resolve(flag('--music')!) : null,
        format: (flag('--format') ?? '9x16') as '9x16' | '16x9' | '1x1',
        seconds: Number(flag('--seconds') ?? 15),
        workDir: resolve(out, 'work'),
        onStage: async stage => { process.stderr.write(`stage ${stage}\n`); },
      });
      for (const [name, path] of [['film.mp4', result.mp4], ['thumb.jpg', result.thumb], ['sheet.jpg', result.sheet]] as const) copyFileSync(path, resolve(out, name));
      if (!result.qa.passed) process.exitCode = 1;
      return { ready: result.qa.passed, out, bpm: result.bpm, cuts: result.cuts, durationMs: result.durationMs, warnings: result.warnings, qa: result.qa };
    }
    case 'remote': {
      const { remote } = await import('./remote.js');
      return remote(rest);
    }
    case 'lyrics': {
      // studio lyrics --song song.mp3 --lrc words.lrc [--title "..."] [--format 9x16] [--out dir]
      const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
      if (!flag('--song') || !flag('--lrc')) throw new Error('Usage: lyrics --song song.mp3 --lrc words.lrc [--title "Song"] [--format 9x16|16x9|1x1] [--out dir]');
      const { lyricsPlan, songLines } = await import('../src/pipeline/lyrics.js');
      const { renderFilm } = await import('../src/pipeline/render.js');
      const plan = lyricsPlan({ title: flag('--title') ?? 'Lyrics', lrc: await readFile(flag('--lrc')!, 'utf8'), songAssetId: '0'.repeat(24), language: 'en', format: (flag('--format') ?? '9x16') as '9x16' | '16x9' | '1x1' });
      const out = resolve(flag('--out') ?? 'out/lyrics');
      mkdirSync(out, { recursive: true });
      const result = await renderFilm({ plan, voice: { ...voiceEntry('test:tone')!, id: 'song' }, keys: loadEnv(), workDir: resolve(out, 'work'), cacheDir: resolve(out, 'cache'), song: { file: resolve(flag('--song')!), lines: songLines(plan) }, onStage: async stage => { process.stderr.write(`stage ${stage}\n`); } });
      for (const [name, path] of [['film.mp4', result.mp4], ['thumb.jpg', result.thumb], ['sheet.jpg', result.sheet], ['captions.srt', result.srt], ['captions.vtt', result.vtt]] as const) copyFileSync(path, resolve(out, name));
      if (!result.qa.passed) process.exitCode = 1;
      return { ready: result.qa.passed, out, lines: songLines(plan).length, durationMs: result.durationMs, warnings: result.warnings, qa: result.qa };
    }
    case 'render': {
      // studio render <plan.json> --voice <id> [--out dir]
      const [file, ...flags] = rest;
      const flag = (name: string) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : undefined; };
      if (!file || !flag('--voice')) throw new Error('Usage: render <plan.json> --voice <voiceId> [--trace trace.json] [--out dir] [--quality draft|standard|high]');
      const checked = validatePlan(JSON.parse(await readFile(file, 'utf8')));
      if (!checked.plan) { process.exitCode = 1; return { valid: false, issues: checked.issues }; }
      const voice = voiceEntry(flag('--voice')!);
      if (!voice) throw new Error('Unknown voice. Run capabilities to list voices.');
      const env = loadEnv();
      const blocked = voiceUnavailable(voice, env);
      if (blocked) throw new Error(blocked);
      const out = resolve(flag('--out') ?? 'out/render');
      mkdirSync(out, { recursive: true });
      const { renderFilm } = await import('../src/pipeline/render.js');
      const started = Date.now();
      const traceFile = flag('--trace');
      const recorded = traceFile ? JSON.parse(await readFile(traceFile, 'utf8')) : null;
      const { keyStates } = await import('../src/trace/states.js');
      if (checked.plan.mode === 'code_lab' && !recorded) throw new Error('A Code Lab plan needs --trace <trace.json> from the trace command.');
      const result = await renderFilm({
        trace: recorded ? { states: keyStates(recorded.steps), code: recorded.code } : undefined,
        plan: checked.plan, voice, keys: env, workDir: resolve(out, 'work'), cacheDir: resolve(process.env.VOICE_CACHE_DIR || resolve('.data', 'cache', 'voice')),
        quality: (flag('--quality') as 'draft' | 'standard' | 'high' | undefined) ?? 'draft',
        onStage: async stage => { process.stderr.write(`stage ${stage}\n`); },
      });
      for (const [name, path] of [['film.mp4', result.mp4], ['thumb.jpg', result.thumb], ['sheet.jpg', result.sheet], ['captions.srt', result.srt], ['captions.vtt', result.vtt]] as const) copyFileSync(path, resolve(out, name));
      const report = { ready: result.qa.passed, out, renderMs: Date.now() - started, durationMs: result.durationMs, timing: result.timing, warnings: result.warnings, qa: result.qa };
      writeFileSync(resolve(out, 'qa.json'), JSON.stringify(report, null, 2));
      if (!result.qa.passed) process.exitCode = 1;
      return report;
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
    default: throw new Error('Usage: studio <doctor|capabilities|schema|validate-plan|captions|brief|trace|plan|render|montage|lyrics|remote>');
  }
}
main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Command failed'); process.exitCode = 1; });
