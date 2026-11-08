# SceneSpindle: handoff

Updated 2026-11-08 (v4). Read this first on any machine. Status detail: `docs/PROJECT_STATUS.md`.

## 0. What is in this folder

- A full git checkout of `Aryanjstar/scenespindle` with branch **`finish-and-qa`** checked out: the v4 commits on top of `main` (`dbbe4d7`). Nothing is pushed yet: the account on the build machine had no write access.
- Production on Azure **already runs this branch** (image tag = latest commit). Merge it so `main` matches production.
- Not included on purpose: `node_modules`, `.next`, `.env.local` (keys), `.data` (local database files, renders, password files). Make `.env.local` from `.env.example`.

## 1. Push and open the PR (from an account with write access)

```bash
unzip scenespindle-v4.zip && cd scenespindle
```

```bash
git status && git log --oneline -7
```

```bash
git push -u origin finish-and-qa
```

```bash
gh pr create --base main --head finish-and-qa --title "Finish the studio: leased jobs, all screens, release gates, karaoke lyric videos" --body-file docs/PR_DESCRIPTION.md
```

Then merge it (squash or merge commit, either is fine). If you prefer a fork: push the branch to your fork and open the PR against `Aryanjstar/scenespindle:main`.

## 2. Run locally

Needs Node 22+, FFmpeg, Chrome, a MongoDB replica set (`mongod` on PATH for the test suites). Optional: whisper.cpp (`WHISPER_MODEL=/path/ggml-base.bin`), Blender (paired PCs, cinematic 3D).

```bash
npm ci
```

```bash
npm run check
```

```bash
npm run dev
```

```bash
npm run worker
```

| Command | What it proves |
|---|---|
| `npm run check` | 55 unit tests, typecheck, lint |
| `npm run e2e` | Production build, then three browser journeys, each with its own MongoDB, app and worker: two creators at 1280 and 390 px; every film mode; every new screen (library, characters, styles, series, reel captions, exports, tools, queue, settings, paired PCs, command palette, no sideways scroll at 390 px) |
| `npm run agent -- pair <CODE> --url <studio>` then `npm run agent` | A paired PC renders your "My paired PC" projects with its own keys and tools |

Local owner account: `MONGODB_DB=<db> npm run create-owner -- --rotate` makes a new password (or pipe one in with `--password-stdin`).

## 3. Azure (deployed)

Resource group `rg-scenespindle` (Central India). Live: https://scenespindle.blackforest-f0b810b6.centralindia.azurecontainerapps.io

| Resource | Name | Purpose |
|---|---|---|
| Container App | `scenespindle` | Web |
| Container App | `scenespindle-worker` | Worker: planning, renders, captions, stills, styles, exports, tools |
| Registry | `ssacr836865` | Images; each build renders a test film, a 3D-stage film (fails on a black frame), and runs whisper.cpp |
| Storage | `ssmedia836865` / `media` | Private media, signed URLs |
| AI Services | `ss-ai-836865` (`gpt-image`) | Story stills and character sheets |

Redeploy from the repo after `az login`: `bash scripts/azure-deploy.sh`. Logs: `az containerapp logs show -n scenespindle-worker -g rg-scenespindle --follow`.

The image now includes whisper.cpp v1.8.4 (static) and the multilingual base model: reel captions and karaoke timing work even when ElevenLabs is unavailable.

## 4. Settings (names only; values live in `.env.local` and Container Apps secrets)

App: `APP_ORIGIN`, `OWNER_EMAIL`, `AUTH_TOKEN_PEPPER`, `MONGODB_URI`, `MONGODB_DB`, `TRUST_PROXY_HOPS` (1 on Azure). Providers: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `SARVAM_API_KEY`, `AZURE_IMAGE_ENDPOINT/KEY/DEPLOYMENT`. Storage: `STORAGE_DRIVER=azure`, `AZURE_STORAGE_*`. Optional: `WHISPER_CLI`, `WHISPER_MODEL`, `BLENDER_BIN`, `RESEND_API_KEY`, `MAIL_FROM`. Full list with comments: `.env.example`.

## 5. What changed in v4 (2026-11-07)

- **Jobs**: every job runs in the worker under one lease runner (`worker/lease.ts`); requests only enqueue. Crash, cancel and retry work for every job type; no project can stay busy forever.
- **Usage**: reserved before a call, settled on success, released on failure; owner sets per-creator caps (Settings).
- **Story and Cartoon**: per-character stage looks, ten sets, eight actions, shot sizes, speaker-only lip sync; illustrated stills with cast references; Blender cinematic 3D on a paired PC.
- **Montage**: styles from the Claude Edits toolkit (day-in-my-life vlog, tutorial, cinematic), micro-cuts, liveliest-shot pick, speed ramps, grades, CC0 edit sounds, free-text edit notes, styles learned from uploaded reference reels.
- **Caption a reel**: timing heard from the reel (ElevenLabs Scribe, whisper.cpp fallback) or pasted SRT/LRC; placement away from faces; **Karaoke lyrics** style built to the creator's lyric-video notes (romanized lowercase line above the head, Instrument Serif italic gradient, words lit as sung, push-in, night grade, -17.6 LUFS).
- **More**: account and password, sessions, invite resend, duplicate, scene regenerate, storyboard versions and restore, make current, share download toggle, voice samples, brief research with dated sources, series briefs with frozen versions, continuity and places, resumable uploads, asset delete, exports (audio, package zip, OTIO), banners and profile copy, render queue, command palette (Cmd/Ctrl+K), Code Lab in JavaScript.
- **Screens**: every page rebuilt on one API client; every button has a pending state and visible errors; phone width checked.
- **Home page** (2026-11-08): films play only when clicked, with sound, once to the end; starting one pauses the others; nothing downloads before a click. Films re-encoded at 720p with fast start (0.5 to 2 MB) and cached for a year. New Paper boat (Meera and Dadi, six beats) and Tikku (stop, look, cross). Favicon is the spindle mark.
- Editing preferences (fonts, vlog, karaoke): `skills/scenespindle-edit-style/SKILL.md`. Toolkit mapping: `docs/reference/CLAUDE_EDITS_TOOLKIT.md`.

## 6. Verified (2026-11-07)

- Unit, type, lint and all three browser journeys pass.
- Real renders with frame sheets reviewed: Explainer, JavaScript Code Lab, two-character 3D Story, illustrated Story (Azure stills), vlog montage, lyrics, reel captions (pasted and heard), karaoke lyric video (-17.7 LUFS, peak -4.0 dB), Blender Story via a paired PC. OTIO exports load in OpenTimelineIO 0.17.
- Live Gemini planning, brainstorm and copilot.
- Production: new revision serving 100%, health and database up, worker running all lanes; signed-out requests 401, foreign origin 403, bad share token 404.

## 7. Open

1. **Signed-in check on production**: sign in once, make a film, share it.
2. **ElevenLabs account is out of credits** (9 left): narrator voices fail until it resets or is topped up; use Sarvam (Hindi) or the test tone meanwhile. Transcription falls back to whisper.cpp automatically.
3. **Publishing** to YouTube and Instagram: not built (needs OAuth apps).
4. **Mail** (Resend) not configured: invites and resets are copy-a-link.
5. **Rotate keys** that were pasted in chat earlier (Gemini, ElevenLabs, Sarvam, Higgsfield, Atlas), then update Container Apps secrets and restart both apps.
