# SceneSpindle — project status

**Updated 2026-11-08. A prompt can make a film on its own. Customize still opens the full editor. If a voice is out of credits, another configured voice reads the whole film and the job says who. Homepage story, cartoon, series and Code Lab films were rendered again: two arms each, and the code sits on a paper card.**

**Updated 2026-11-07. v4 pass: every job runs in the worker under a lease; all studio screens rebuilt; remaining release gates built except social publishing. Verified locally end to end; see below.**

## v4 pass (2026-11-07)

**Shipped**
- Jobs: planning, copilot, stills, renders, reel captions, style learning, exports and tools all run in worker lanes on one lease runner (sweep, cancel, retry for every type). Usage reserved before calls, settled on success, released on failure; per-creator caps set by the owner.
- Story and Cartoon: per-character stage looks, ten sets, eight actions, shot sizes, speaker-only lip sync; illustrated stills (with cast references) as a look. Cinematic 3D through Blender on a paired PC.
- New: account and password, sessions, invite resend, duplicate, scene regenerate, storyboard versions and restore, make current, share download toggle, capabilities, voice samples, brief research with dated sources, series briefs, frozen series versions with continuity and places, resumable uploads, asset delete, exports (audio, package zip, OTIO), paired PC agents (`npm run agent`), banners and profile copy, render queue, command palette, Code Lab in JavaScript.
- Montage styles from the Claude Edits toolkit (day-in-my-life vlog, tutorial, cinematic) with micro-cuts, liveliest-shot pick, ramps, grades, CC0 sound effects, edit notes and styles learned from uploaded references.
- Caption a reel: word times from the reel (ElevenLabs Scribe, whisper.cpp fallback), placement away from faces and text, and a Karaoke lyrics style built to the creator's lyric-video notes.

**Checked (local, 2026-11-07)**
- 55 unit tests, typecheck, lint. Three browser journeys pass (`npm run e2e`): two creators at 1280 and 390 px; modes; and every new screen including no sideways scroll at 390 px.
- Real renders with frame sheets looked at: two-character Story (stage), illustrated Story (Azure stills), Code Lab in JavaScript, vlog montage, lyric video, reel captions (pasted and heard), karaoke lyric video (-17.7 LUFS, peak -4.0 dB), Blender cinematic Story on a paired PC. OTIO files load in OpenTimelineIO 0.17.
- Live Gemini planning, brainstorm and copilot. ElevenLabs is out of credits on this account; transcription fell back to whisper.cpp as designed.

**Still open**: YouTube/Instagram publishing (needs OAuth apps); Resend mail; a signed-in check on production after deploy.

## Current verified position

- Live at https://scenespindle.blackforest-f0b810b6.centralindia.azurecontainerapps.io with web and worker apps, private Azure Blob storage and Atlas database `scenespindle`. The public page shows eight new films rendered by the current studio. Older showreel files are no longer linked.
- Modes that render end to end: Explainer, Code Lab (trace-driven), Audio (kinetic type), Montage (beat cuts), Story and Cartoon (seekable Three.js stage: head, mouth and body from the narration), Lyrics (sung lines on a dark stage). Formats 9:16, 16:9, 1:1. Languages English, Hindi, Hinglish.
- Studio screens: cast picker, series bible and episodes, lyric song plus LRC, API tokens, and caption-a-reel (SRT or LRC times, or evenly spaced lines, creator-chosen band). Paid image sheets and face-avoiding vision captions stay off.
- Brief-driven planning with verbatim exact scripts, scene-scoped copilot, QA-gated current film, versions, downloads, share links, invites, resets, rate limits, soft delete with restore and retention sweep, usage ledger.
- Verification this step: 39 unit tests, typecheck, lint, local Story, Cartoon and Lyrics renders with frame review, and both browser journeys (`node test/integration/browser.mjs` and `modes.mjs`) including a Story render, the lyrics screen and an API token. Earlier: live provider renders, production worker, Blob round trip. Details: HANDOFF.md section 5.
- Not verified: signed-in browser session on production, Resend delivery.

## Open release gates

Paired agents, OTIO, cutouts, publishing, brief research, persistent voice cache, vision-based caption placement, paid stills and video-model clips. See HANDOFF.md section 7.

## Historical status (retained verbatim from the previous log)

# Leela — Project Status

**Last updated:** 2026-10-19

This is the progress log. Read it before building, and update it in the same change when a layer or major feature is added or materially changed. Product scope stays in `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/API.md`. This file does not override them.

## Current position

The public site shows five single-take films. Each has one continuous voice, and the picture moves when that voice reaches it. The live host is `leela-kappa.vercel.app`. The git repo is Lila. Reference notes and secrets stay off the remote.

| Milestone | Status | Recorded on |
| --- | --- | --- |
| Research and design docs | Complete — docs only, cross-checked 2026-10-19 | 2026-10-19 |
| Layer 0: engine spikes (S1–S4) | In progress — pipeline renders; human scores and two hosts still open | 2026-10-19 |
| Layer 1: shell and studio | In progress — landing, sign-in, studio home, project create, rename, delete, idea autosave. Invites and the command palette are not. | 2026-10-20 |
| Layers 2–6 and 8, first working path | In progress — plan, storyboard edit, preview, approve, share link, copilot keep/discard, Code Lab trace, library characters and uploads, YouTube/Instagram connection gate. MP4 render on a worker and OAuth posting are not. Checked locally against `leela-dev` on 2026-10-20. | 2026-10-20 |

## 1. Research and design docs

**Status:** Complete — docs only, cross-checked

**Recorded on:** 2026-10-19

### Implemented

- `docs/PRODUCT.md`: name (Leela, working), modes, page map, layers 0–10.
- `docs/PRD.md` v1.0: objects, layers with done-when, journeys J1–J6, functional requirements per layer, permissions, edge cases.
- `docs/ARCHITECTURE.md` v1.0: stack, the scene graph contract (§6), Code Lab tracing (§8), provider adapters and quota router (§9), MongoDB job queue and worker (§10), render stages (§11), compiler (§13), failure table.
- `docs/DATABASE.md` v1.0, `docs/API.md` v1.0, `docs/DESIGN.md` v1.0, `docs/RESEARCH.md` (free tiers and licences, checked 2026-10-19).
- `docs/reference/NAMASTE_VIDEO.md`, `docs/reference/REEL_STUDIO_LEARNINGS.md`, `docs/reference/MOTION_CRAFT.md`.
- `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*`, `.claude/agents/{doc-cross-checker,render-qa}.md`, `.env.example`, `.gitignore`.
- `docs/PLAYBOOK.md` and `docs/templates/` copied from The Wedding Home, with a Leela note for AI-media products.

### Validation

- Research: three parallel passes (providers, engines and assets, UI) against official pages on 2026-10-19; unverified items are marked in RESEARCH.md.
- Reference: Akshay's repo was cloned and its PRD, system design, pipeline design, contracts, and status read in full; API and DB designs skimmed by section; namastevideo.ai read.
- Doc cross-check on 2026-10-19: the four docs, PRODUCT, and DESIGN were checked against `docs/templates/CROSS-CHECK.md`. Mismatches (job kinds, revision classes, spike exit, delete, pronunciations, rate limits, name mappings) were fixed in the same pass.
- Motion craft: the four public guides, the starter kit, and the "motion design studio" write-up were read. The method is in `docs/reference/MOTION_CRAFT.md`. The kit's audio, model weights, and engine were not copied in. The studio write-up's banned AI look and spring motion are now rules. Its Playwright renderer is not a second engine.

### Boundaries

- No code, no provider keys used, no accounts created, nothing deployed or committed.
- Free-tier numbers are a snapshot; re-check before the layer that uses them.

## 2. Explainer pipeline (layer 0, partial)

**Status:** In progress

**Recorded on:** 2026-10-19

### Implemented

- Plan contract, validator, and a closed storyboard that expands into the scene graph (`src/contracts/plan.ts`).
- Compiler from that plan to a HyperFrames project (`src/compiler`). Text is escaped. Tweens are numbers.
- Adapters for Gemini, ElevenLabs, and Sarvam (`src/server/providers`).
- Commands: `npm test`, `npm run check-providers`, `npm run make-video`.
- A 40.8 s 1080×1920 reel, "Why Tops and Moons Stay Up", at `spikes/s1-render/out/why-the-moon-misses.mp4`.
- Five valid storyboards, one adversarial plan that did not leak, a Hindi Sarvam sample, and a Python tracer for `fib(4)` and binary search.

### Validation

- `npm test`: 7 tests, including HTML injection, a cue that is not in the line, a protected name, and the trace call order.
- Provider probe: Gemini, ElevenLabs, and Sarvam answered. ElevenLabs refused library voices on the free plan.
- `hyperframes check`: 0 errors. Render: 49 s. ffprobe: 1080×1920, 30 fps, H.264, AAC 48 kHz, 40.8 s. Loudness −14.5 LUFS, true peak −1.4 dBTP.
- Frames looked at: hook with the Devanagari kicker and lattu, the orbit diagram, and the "Balanced!" ending.

### Still open

- Your score on the five showreel films in `spikes/showreel/out/`.
- Your 1–5 score on the first narrated reel was 3/5. Too simple. The showreel is the answer to that.
- Word timings for Sarvam.
- Pyodide in a browser worker (the tracer runs in CPython today).
- Studio UI. Not started, on purpose.
- ARCHITECTURE §23 is unchanged until you ask for that edit.

## Upcoming development

Next: your score on the reel. Then Sarvam word timings, the Pyodide worker, and the studio shell. Spike decisions stay in the reports until you ask to lock them in ARCHITECTURE.md.

## Updating this document

- Update the current position, the milestone table, and the date when a layer progresses.
- Add a numbered milestone for each layer or major feature: status, date, what was implemented, what was actually checked, what is still out of scope.
- Keep earlier milestones. Note a follow-up on the milestone it changes.
- Statuses: **In progress**, **Complete — UI with sample data**, **Complete — end to end**, **Complete — docs only**. Do not mark unverified work as complete.
- No credentials, tokens, or connection strings here.
