# SceneSpindle

**An invite-only studio for short films.** Bring a topic, a script or a piece of code. SceneSpindle plans the scenes, a narrator reads them, and code draws every frame to the measured voice. You get a narrated, captioned MP4 with subtitles, a poster and a share link.

New machine or new agent: start with [HANDOFF.md](HANDOFF.md). Current state: [PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## What works today

- Explainer and Code Lab films, 9:16, English.
- Idea, brief, AI-planned or imported storyboard, line edits, copilot revisions you keep or discard.
- Approve, then a worker renders: narration (ElevenLabs, Sarvam), timing from measured audio, HyperFrames frames, FFmpeg mix at -14 LUFS, captions, SRT/VTT, poster, frame sheet and automatic QA. Only a film that passes QA becomes current.
- Private streaming, versions, downloads, share links with optional download, revoke.
- Invites, password reset, rate limits, per-creator isolation, soft delete.

Other modes, formats and languages show in the studio as unavailable until they render.

## Run it

Node 22+, FFmpeg, a MongoDB replica set (Atlas works) and Chrome for the browser test.

```sh
npm ci
npm run check            # unit tests, typecheck, lint
cp .env.example .env.local   # fill in Mongo, pepper, owner email, keys
npm run create-owner     # prints where the owner password file is
npm run dev              # web on :3000
npm run worker           # renders films; run in a second terminal
npm run e2e              # full two-creator browser journey with its own database
```

## CLI

Machine-readable JSON, nonzero exit on failure, no credentials printed.

```sh
npm run --silent studio -- doctor
npm run --silent studio -- capabilities
npm run --silent studio -- schema
npm run --silent studio -- validate-plan examples/plans/why-ice-floats.json
npm run --silent studio -- captions words.json --max-words 3
SCENESPINDLE_TEST_VOICE=1 npm run --silent studio -- render examples/plans/why-ice-floats.json --voice test:tone --out out/smoke
npm run --silent studio -- render examples/plans/why-ice-floats.json --voice elevenlabs:alice --out out/ice
```

`render` writes `film.mp4`, `thumb.jpg`, `sheet.jpg`, `captions.srt`, `captions.vtt` and `qa.json`.

## Deploy

`docker compose up -d --build` runs the web app and the worker on one machine with a shared volume. See [HANDOFF.md](HANDOFF.md) section 4 for Atlas, HTTPS, keys and what is not yet possible on Vercel.

## Architecture and rules

Next.js 16, TypeScript, MongoDB (jobs are the queue), HyperFrames + GSAP + FFmpeg, provider adapters with a usage ledger. Model output is data, never code: plans name registered components and every string is escaped by the compiler. Sources of truth: [PRD](docs/PRD.md), [system design](docs/ARCHITECTURE.md), [database](docs/DATABASE.md), [API](docs/API.md); also [design](docs/DESIGN.md) and [AGENTS.md](AGENTS.md).

Inspired by [NamasteVideo.ai](https://github.com/akshaymarch7/namaste-video-ai). UI craft follows [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0). Never commit credentials, personal media or generated films.
