# SceneSpindle

**AI Video Production Studio.** An invite-only studio for turning scripts, ideas, code and media into reviewed films, using structured plans and trusted renderers.

For a fresh account or machine, start with [HANDOFF.txt](HANDOFF.txt).

The product combines the existing web app with Reel Studio's editing workflows. The target includes 2D/3D films and recurring episodes; those capabilities are being delivered in slices. **The current web render flow is preview-only, not a complete hosted MP4 pipeline.** See [project status](docs/PROJECT_STATUS.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Start locally

Use Node 22 LTS and npm. Python 3 and FFmpeg are needed for media/trace tests; MongoDB must be a replica set for transactional editing (Atlas works). From a fresh checkout:

```sh
npm ci
npm test
npm run typecheck
```

Create `.env.local` from `.env.example` only if it does not already exist. Supply your own Mongo URI/database and auth configuration, then run `npm run dev` and, in another terminal, `npm run worker` to process preview jobs. Do not overwrite existing credentials. `npm run studio -- doctor` checks the local Node version and media executables without printing credentials; it does not connect to MongoDB or providers.

Run `npm run e2e` with Chrome and `mongod` installed to build the app and exercise the studio as two creators at desktop and 390 px. The suite starts a disposable replica set and a production server on loopback ports 27932 and 3221.

## Use any AI assistant or IDE

Read [AGENTS.md](AGENTS.md) and [the editing workflow](docs/AGENT_WORKFLOW.md). No Claude, Cursor, Codex or other assistant subscription is required to run the repository.

```sh
npm run studio -- capabilities
npm run studio -- schema
npm run studio -- validate-plan path/to/plan.json
npm run studio -- captions path/to/words.json --max-words 3
```

These commands run locally. Schema export, validation and caption grouping emit JSON. Invalid inputs produce a nonzero exit status. Capabilities reflect the implemented v1 explainer contract, not the whole roadmap. Caption grouping consumes measured word times; it does not create timestamps from a prompt.

The project Brief panel and offline CLI can now refine and approve a basic brief. For a machine-readable CLI response, use npm run --silent studio -- brief refine --input brief.json. The JSON file needs project (projectId, mode, format, language, targetMs) and input (rawRequest, optional audience, exactScript, directionId). The web workflow stores an owner-scoped version. Research, series briefs and the production planning gate are still upcoming; see [status](docs/PROJECT_STATUS.md).

## Architecture and contribution

Next.js/TypeScript, MongoDB, provider adapters, HyperFrames and FFmpeg. Planned heavy Blender rendering runs on a paired PC or Azure worker. Private media stays local unless explicitly opted into hosted processing. Third-party paid services remain disabled without configured authorization; Azure sponsorship balance is not yet verified.

Source of truth: [PRD](docs/PRD.md), [system design](docs/ARCHITECTURE.md), [database design](docs/DATABASE.md), [API](docs/API.md). Also read [design](docs/DESIGN.md), [research review](docs/REFERENCE_REVIEW_2026-11-02.md), and [delivery plan](docs/IMPLEMENTATION_PLAN.md). Historical specifications are retained under docs/history/.

Inspired by [NamasteVideo.ai](https://github.com/akshaymarch7/namaste-video-ai); reused third-party code/assets must retain their own license notices. Screenshots and reference links are inspiration, not redistribution permission. Never commit credentials, personal media, generated large artifacts or local environments.

Planning references: [Brief Builder](docs/BRIEFING_WORKFLOW.md) and [on-demand toolbox](docs/toolbox/README.md). Implementation is in progress; the brief workflow is partial and the preview worker does not require plugins or models.

## Offline storyboard preview

`npm run studio -- preview path/to/plan.json --output /tmp/storyboard.html`

Open the resulting HTML file in a browser. It bundles its runtime and fonts and makes no provider calls. It is a silent visual preview with estimated timing; it is not an MP4 or aligned narration. Existing output files are never overwritten. The same preview compiler serves the web studio. See [the free-first review](docs/RESEARCH_2026-11-16.md) for researched alternatives and their actual integration status.
