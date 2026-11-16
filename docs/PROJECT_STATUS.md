# SceneSpindle — project status

**Updated 2026-11-16. Implementation in progress; no full product release yet.**

## 2026-11-16 — Portable preview and release checks

- Added `studio preview <plan.json> --output <preview.html>`: a free offline visual review path with no provider calls. It refuses overwrites and labels output silent/estimated.
- Web and CLI share an in-memory preview compiler with embedded runtime/fonts, explicit scene/caption visibility, deterministic seeking and viewport fitting. Rendering compositions keep framework-owned visibility.
- Removed Google Fonts build fetches in favor of installed fonts; corrected SceneSpindle branding and database health HTTP status.
- Added runnable ESLint configuration; pinned TypeScript 6.0.3 for parser compatibility; updated locked Mongoose/follow-redirects to remove the two reported high-severity advisories. Eight moderate tooling advisories and five lint warnings remain.
- Verification: 21 unit tests, typecheck, lint (zero errors), production build and disposable MongoDB/Chrome desktop/390 px journeys, including loaded preview fonts and seek visibility. Free alternatives and limits are documented in RESEARCH_2026-11-16.md. This does not complete the open release gates below.

## Current verified position

- Portable offline CLI, caption grouping, revision-conditional draft/candidate editing and Code Lab browser-worker traces work for the documented v1 scope.
- Two creators can sign in and complete the project/HTML-preview journey at desktop and 390 px. Owner-scoped project and brief access denies the other creator.
- Configured owner can create/revoke one-time invitation links; the invited creator can join. The browser test covers replay and redemption races.
- Approval transactionally freezes a storyboard and enqueues a preview job. A separate worker leases, recovers, cancels and retries preview work. Result is **silent HTML with estimated timing**, never a ready MP4.
- Basic project Brief Builder works in web/CLI. It saves a rough request, one direction choice and an immutable approved version. Exact scripts remain frozen. External research, series scope and production-plan gating are open.

Verification on 2026-11-04: 20 unit tests, TypeScript typecheck, production build and the two-creator Playwright journey passed against a disposable MongoDB replica set, including invite and worker recovery, brief approval/replay, stale refinement and foreign-owner denial. This is not an MP4 release test.

## Open release gates

Actual narrated/aligned MP4; private artifact storage and delivery; mail/reset/rate limits; full durable job and budget controls; provider/voice/format parity; approved-brief-to-production wiring and source research; Reel Studio editing flows and visual QA; series/3D/paired workers; optional timeline/matting; publishing, static creator utilities, accessible UI and rollout. See IMPLEMENTATION_PLAN.md and REEL_STUDIO_PARITY.md for acceptance by slice. No complete claim follows from an HTML preview, skill or recipe.

[HANDOFF.txt](../HANDOFF.txt) is the fresh-account entrypoint and names the implementation branch. The older notes below are historical; some contain superseded statements and do not override this section.

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

## Deployment evidence — 2026-11-16

Code commit `d7fb4d6` pushed to `codex/portable-previews-release` at Aryanjstar/scenespindle and deployed from a clean git archive to the existing Vercel project. Production alias: https://leela-kappa.vercel.app. Deployment ID: `dpl_EjTACPHscQkmVoCWr3TWhWzDKJ2t`, READY. Read-only production checks: homepage/sign-in/join 200; health 200 with MongoDB up; private project/invite APIs 401 without a session. Local E2E used disposable creators, not production accounts. The persistent worker was not deployed by this Vercel web deployment; production queued jobs require a separately running worker. Narrated MP4 and the listed release gates remain open.
