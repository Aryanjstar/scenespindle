# SceneSpindle — implementation and verification plan

Updated 2026-11-04 (evening). Documentation precedes implementation. **Implementation is in progress.** No milestone is complete merely because its plan exists.

| Slice | Requirements | Deliverable / release gate | Status |
|---|---|---|---|
| 0. Research and specification | SS-01,20,21 | Updated contracts, brief workflow, pinned on-demand toolbox and acceptance matrix | Complete — docs only |
| 0b. Portable foundation | SS-01,03,08 | Portable CLI, caption grouping and draft/candidate concurrency regressions | In progress; offline CLI and database race checks implemented; browser journeys remain |
| 1. Identity, storage and job integrity | SS-02,04,05,14 | Two-creator browser journey; invites/reset; private storage; atomic approval and durable worker; actual MP4 | In progress: invites, reset, rate limits, leased MP4 worker, QA-gated current film, private local storage, voice allowance ledger done 2026-11-04; blob storage, planner metering, deletion cleanup open |
| B. Brief Builder (after slice 1, before slice 2) | SS-20,21 | Shared brief state, contextual research, revision-bound questions, prompt bundles and UI/CLI/IDE parity | In progress: project brief/approval and offline CLI implemented; research, series and production gate open |
| 2. Reference parity and providers | SS-06,07 | Reference examples, configurable planner, voices/alignment, revisions, formats and cache recovery | Planned |
| 3. Editing and illustrated stories | SS-08,09,10,15 | Montage/cover/talking-head/kinetic/story/launch artifacts with inspected frames and audio | Planned |
| 4. Series and 3D | SS-11,12,13 | Recurring cast; full 5–10min episode; second episode; remote PC and Azure render evidence | Planned |
| 5. Optional interchange and cutouts | SS-18,19 | Portable package/OTIO round trip; mask quality and timing tests | Approved optional scope; planned |
| 6. UI, publishing and rollout | SS-16,17 | All advertised flows accessible; publishing recovery; backup/migration/rollback; real showreel | Planned |
| 6a. Static creator tools and full Reel Studio parity | SS-22 | Banner and profile-copy journeys; checklist evidence for every Reel Studio capability or documented exception | Planned |

Full Reel Studio feature inventory and evidence gates: [REEL_STUDIO_PARITY.md](REEL_STUDIO_PARITY.md). Video workflows are planned; static banners and profile copy are explicitly included in slice 6a. Reel Studio source code remains in its separate repository until adapted.

## Audit backlog

- New HTML previews are labeled preview; legacy HTML-only ready records are treated as preview on read. Public sharing is disabled pending verified MP4 serving. No durable render worker exists.
- Catalog overstates mode/language/format coverage; usage is a placeholder.
- Planner ignores portions of project settings; revision requests can affect all scenes.
- Draft/candidate writes now use revision-conditional updates and transactional keep; the broader planning and approval paths still need concurrency protection.
- Storyboard/video versions use counts; job creation is non-atomic.
- Project deletion leaves related records; uploads use local disk and an 8MB in-memory limit.
- Code Lab interpreter runs on the UI thread; Python/JavaScript worker sandbox is unfinished.
- Preview fonts/assets and CSP need a real browser regression.
- Renderer shell helpers in Reel Studio suppress failures; dependency/path assumptions are not portable.
- Existing traces/media can grow Mongo documents; binary storage migration remains outstanding.
- Snapshot all render settings and character/series versions before long-form/3D work.

## Test evidence

Baseline before this slice: 11 node:test cases and typecheck pass; Mongo ping succeeds. This is not end-to-end readiness. Each slice records commands/results in PROJECT_STATUS.md and a private dated journey entry. Database regressions use a separate disposable database, never production. Browser journeys use two creators at desktop and 390px. Provider/live-render tests require configured allowance and use synthetic or approved media.

## Research additions accepted

Phrase captions, meaning-driven kinetic passes, reference/animatic approval, deterministic seeking, independent sound mixing, reusable 3D rigs, series continuity, assistant-independent JSON commands, and optional editable timeline exports/subject cutouts. References and access limitations are in REFERENCE_REVIEW_2026-11-02.md.

## Git and deployment

GitHub name approved: Aryanjstar/scenespindle. Update origin after remote rename; preserve local folder paths and historical project assets. No database/cookie rename as a branding side effect. No automatic commit/push or production deployment in this slice. Preserve the user's untracked showreel and editor configuration work.

## Final additions and dependencies

- Brief Builder precedes new automatic planning. Details and evaluation cases: [BRIEFING_WORKFLOW.md](BRIEFING_WORKFLOW.md).
- [Toolbox](toolbox/README.md): all 24 submitted resources catalogued, selected docs/license snapshots pinned, full skill paths indexed. No installable-package or all-files-downloaded claim. No global autoload.
- Instagram/YouTube/marketing references inform briefing and packaging; developer workflows/browser tools inform scoped QA; Blender MCP is optional asset authoring. AirLLM is a benchmark-only candidate; trading/resume/WhatsApp references stay outside product scope.
- Optional editable export and subject cutouts remain approved. Existing source licenses and privacy boundaries remain requirements.
- Research limits, meaningful-choice questions, exact-script preservation, provenance and paused/noninteractive behavior are acceptance requirements, not implementation discretion.

Next implementation order: portable foundation → identity/storage/jobs → Brief Builder → provider/reference parity → editing → series/3D → optional interchange/cutouts → UI/publishing → static creator tools and full parity review. Tests required before declaring a slice complete remain unchanged.

## Local archive additions — 2026-11-02

[Archive review](toolbox/LOCAL_ARCHIVES.md): optional Hook Lab exploration in slice B; optional Roast copy critique in slice 6; a 120-WAV local SFX candidate in slice 3. Simulations are labeled, supplied facts preserved, and single-pass use is the default. Reference storage is complete; the user approved committing and pushing the supplied non-secret files with their source notices. No product feature, sound integration or installation is complete. Implementation is ready to resume in the new account.
