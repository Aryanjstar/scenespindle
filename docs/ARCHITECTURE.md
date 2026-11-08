# SceneSpindle — system design

Version 2.0 · 2026-11-02 · Target architecture; current limitations are explicit in PROJECT_STATUS.md.

## Runtime boundaries

Browser → Next.js API/services → MongoDB metadata/jobs + storage adapter → trusted worker pipeline. Reuse TypeScript/Zod/Mongoose, HyperFrames/GSAP and FFmpeg. Python media analysis runs in a pinned project environment. Do not install a second rendering stack because a reference uses it.

MongoDB jobs are the queue. API requests enqueue and return 202. A worker atomically claims an eligible job, heartbeats a lease, records checkpoints, and conditionally completes only while holding the current lease token. Expired leases are reclaimable; stale workers cannot publish results. Heavy stages run outside request handlers. Mongo transactions require a replica set (Atlas or local single-node replica set).

## Portable automation contract

AGENTS.md is the canonical instruction entrypoint; editor-specific files only point to it. `npm run studio -- <command>` is a shell-neutral machine-readable interface. Initial commands: doctor, capabilities, schema, validate-plan and captions. No particular assistant or subscription is required. Commands return JSON and nonzero exit status on invalid input. CLI diagnostics never print key values, connection strings, raw provider responses or full environment dumps.

Future worker/render commands use the same services and schema versions as the UI, not an alternative pipeline. Authored plans can be imported without a planner. External assistants act as ordinary clients of the JSON contract; they cannot bypass validation, rights, owner isolation or budgets.

## Providers

Separate planner, speech, alignment, image, storage and renderer interfaces. Providers report capabilities, configured model, privacy, cost units and availability. Planner calls receive JSON schemas and return validated data. Keep Azure deployment/model identifiers configurable; existing deployments must be discovered, not inferred from model names. An OpenAI-compatible adapter supports explicitly configured compatible endpoints, including local runtimes; compatibility is tested per endpoint, not promised for every model.

Prefer verified existing Azure deployments for hosted planning. Gemini and other providers are optional. No automatic paid fallback outside Azure. Use server environment/secret storage; environment variables take precedence over local files. No SDK calls from the browser. Retries honor Retry-After and stay within reserved allowance. Cache by provider/model/settings/input hash. If the chosen voice is out of credits, the render uses one other configured voice for the whole film and the job says who spoke. A creator's own voice change is still an explicit choice.

TTS: local Kokoro or configured Azure Speech/Sarvam. Sarvam model/persona compatibility, language_code and audio decoding belong in its adapter. Alignment uses native timings or known-script forced alignment; transcription estimates are flagged. whisper.cpp is the lightweight local candidate, faster-whisper a CPU/CUDA candidate. Install engines/models only for the selected profile; weights have separate provenance.

## Immutable production graph

ProductionPlan v2 extends the current narrow v1 schema with workflow, language, format, episodes/shots, versioned cast/asset refs, cue actions and renderer profile. v1 remains readable; never reinterpret old snapshots. Implement v2 behind a separate schema/migration after the foundation slice. Current v1 supports only its existing explainer subset; schema export must report that honestly.

Shared types: CaptionPolicy; TimedWord; Shot; RenderSpec; AssetRef; CharacterVersionRef; SeriesVersionRef; ProviderCapabilities; ExecutionTarget; RenderManifest. Model output contains registered component IDs and validated props, never HTML, arbitrary file paths, URLs or executable scripts. Resolve private assets server-side with owner checks.

Use a shot dependency graph: script → voice → alignment → timeline; artwork/rigs → scene; timeline+scene → frames; frames+mix+captions → encode+QA. Cache narration, masks, baked simulations and completed shots independently. An SFX/gain change remuxes/re-encodes audio without rerendering picture. Changed narration invalidates that shot's timing and downstream assembly. Cache fingerprints include renderer/tool versions and actual asset hashes.

## Rendering

| Profile | Engine | Constraint |
|---|---|---|
| 2d | HyperFrames and FFmpeg | Trusted components, local fonts, absolute seek timing |
| realtime-3d | Three.js/HyperFrames | GLB assets loaded before seeking; AnimationMixer.setTime; seeded state; no wall-clock loops |
| cinematic-3d | Blender EEVEE/Cycles | Trusted scene builders; approved rigs; baked simulations; shot/frame checkpoints |

Run Blender without untrusted embedded Python or auto-run. Heavy render processes have resource limits and no provider credentials. Blender viewport proxies are approximate; definitive preview frames use final renderer settings. Shared timing/compositing does not imply identical browser/Blender lighting.

Web hosting and CPU workers: Azure Container Apps where compatible. Heavy rendering: Azure Batch on-demand CPU/GPU pools, scale zero while idle. Quota/capacity must be checked before scheduling; never claim a GPU exists from subscription access alone. Spot work is checkpointed. A paired remote PC uses expiring, revocable, project-scoped tokens and signed artifact access, never MongoDB credentials. Full self-hosting uses the same contracts.

## Storage and privacy

Local disk adapter for local-only jobs; Azure Blob for hosted media. Stream/resume uploads and inspect actual media type. Mongo stores metadata and hashes, not base64 video/audio or huge trace arrays. Use private blob containers and short-lived signed URLs after access checks. Local-only paths are never exposed in public responses. Originals are copied, never modified. Asset cleanup respects references and the deletion grace period.

## Atomic writes and recovery

Draft PATCH validates a strict partial body, merges only supplied fields and conditionally updates ownerId/projectId/revision. Persist actual validation issues. Candidate acceptance requires candidate.sourceRevision == expectedRevision == draft.revision and proposed status, then updates draft/message atomically in a transaction. Candidate discard is also conditional. No check-then-save mutation.

Approval, monotonic version allocation and job enqueue are transactional. Use unique active project slots and idempotency records. Deleting versions never reuses version numbers. Publish outcomes can be checking/unknown after an ambiguous remote timeout; reconcile before retrying.

## Optional modules and dependencies

Editable timeline interchange: OpenTimelineIO (Apache-2.0) as an optional Python adapter. Export timing/tracks/media and bake unsupported effects; do not promise arbitrary After Effects round trips. Portable JSON/media packages remain usable without OTIO.

Subject cutouts: optional imported alpha masks first, then a benchmarked local matting adapter. Rembg code is MIT but each model requires its own review; image cutouts are not temporally stable video matting. RobustVideoMatting GPL-3.0 is not bundled by default. OneTake's PolyForm Noncommercial code is not copied into this monetization-oriented product. Reviewed permissive motion kits may contribute isolated registered components with pinned revision and notices.

No new production runtime dependency in the foundation slice. Use existing node:test, Zod and Mongoose. Add Playwright when browser journeys land, with its rationale and pinned version. Add provider/renderer packages only with a runnable feature and measured resource requirements.

## Monitoring and rollout

Track stages, queue age, lease loss, provider units, reservations, failure category and render duration without script/media/token logging. Keep a last-good artifact pointer. Backup metadata before migrations, label existing preview-only videos, and preserve legacy database/cookie names until an explicit migration. Branding is not a database migration. Support rollback to the previous application/worker version and frozen renderer profile.

## Briefing service and context boundaries

Add one shared briefing service for web, CLI and AI/IDE clients, with context resolution, bounded research, clarification decisions, capability validation and prompt compilation. Use the state/contract in BRIEFING_WORKFLOW.md. Render jobs freeze briefVersionId and promptBundleVersion with storyboard/assets; only an approved, current brief can start dependent planning. Scope-specific changes invalidate affected downstream work, not every shot.

Persist creator-approved memory in MongoDB with owner/series scope; do not substitute a shared MCP memory file. Cache research with source date and privacy scope. External pages are never instructions. Store concise evidence, not private reasoning. On-demand toolbox references are developer/creative aids; only HyperFrames is already the chosen core engine. Blender MCP is an optional trusted authoring client, never the public render worker's executable interface. No new runtime package is introduced by this documentation update.

## Addendum 2026-11-07: dependencies and optional tools added in the v4 pass

- Runtime: `@fontsource/{playfair-display, pinyon-script, inter, instrument-serif, great-vibes}` 5.3.0 (OFL font files for montage styles, banners and karaoke lyrics; local `@font-face` only). No other runtime package.
- Optional local tools, detected at run time and reported by `/api/capabilities`: whisper.cpp (`WHISPER_CLI`, `WHISPER_MODEL`) for transcription when ElevenLabs Scribe is unavailable; Blender (`BLENDER_BIN`, paired PCs only) for the cinematic-3d profile, run with `--factory-startup --disable-autoexec` and our trusted scene builder.
- All jobs, including planning, run in the worker under one lease runner (`worker/lease.ts`); requests only enqueue.
