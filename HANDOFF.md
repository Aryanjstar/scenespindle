# SceneSpindle: handoff

Updated 2026-11-04 (night). Read this first on any new machine.


> **Known caveats (as of 2026-11-04, version 3 live):**
> 1. **Browser tests not re-run.** `npm run e2e` has not been re-run since Story, Cartoon, Lyrics, Series, characters and API tokens were added. Unit tests, typecheck and lint pass, and those features were tested through the remote CLI against a local studio. Run `npm run e2e` first and add journeys for the new modes.
> 2. **No screens yet for the new features.** Characters, Series, story stills (draw or redraw), Lyrics (song + LRC), cast picking and API tokens work through the API, `studio remote` and `npm run mcp`. The website does not have screens for them yet.
> 3. **UI not final.** The new colourful theme is applied, but page layouts are the old ones. Aryan's review: not yet up to the mark. A full redesign is pending.
> 4. **Lyric video background** (plain paper) does not suit lyrics. Use a darker or coloured background, or the song's beat with clips or stills behind the words.
> 5. **Captioning an uploaded reel is not built.** It needs speech-to-text for word times, plus caption placement that avoids faces and text (or asks the creator).
> 6. **Production sign-in was never tested by me.** I did not enter the production password. Sign in once, render a film and share it to confirm. The owner password file for the `scenespindle` database is on the machine that made this zip, in `.data/`, which is not included. Make a new one with `MONGODB_DB=scenespindle npm run create-owner -- --rotate`.
> 7. **Not verified:** Resend email delivery (not configured) and Sarvam voices on production.
> 8. **Rotate the keys pasted in chat:** Gemini, ElevenLabs, Sarvam, Higgsfield, and the Atlas database password. Then update the Container Apps secrets (section 4).
> 9. **Costs:** both apps keep one warm replica. The image model (Azure gpt-image-1.5) costs a few cents per picture; a 6-scene story uses about 7. The usage ledger caps it at `IMAGE_MONTHLY_IMAGES` (default 300).
> 10. **Voice cache resets on restart.** It is per container, so re-rendering after a deploy calls the voice provider again.

## 0. Latest round (2026-11-04, late night): read this first

**Built and verified this round:**
- **One API, three clients.** Personal API tokens (Settings API: `/api/tokens`; stored as HMAC, shown once). Every route accepts the browser session or `Authorization: Bearer ss_...`.
  - `studio remote ...` (scripts/remote.ts) covers every studio action; run `npm run --silent studio -- remote help`.
  - `npm run mcp` is an MCP server for AI IDEs (Claude Code, Cursor, Codex) with the same commands.
  - Work done from any client shows up in the others, because they all call the same endpoints.
- **Characters from your image.** Upload a drawing, then `character-create --image`; Azure gpt-image-1.5 redraws it as a character sheet (versioned; films keep the version they used).
- **Story and Cartoon.** Gemini plans beats with picture descriptions and cast; stills are drawn with the cast sheets as references (consistent faces and outfits); approval requires every still; the film renders with a slow camera move and outlined subtitles.
  - Verified through the remote CLI: "Meera and the paper boat" (Story, from one reference drawing) and "Tikku crosses the road" (Cartoon, Hinglish). Both QA-passed.
  - Both films are now on the landing page (`public/films/story-new.mp4`, `cartoon-new.mp4`).
- **Series.** API plus CLI: bible, cast, approved versions, numbered episodes that get the series context.
- **Lyrics.** Your song plus an LRC file gives a lyric video; times come from the file. Verified with the demo LRC (`examples/lyrics/`).
- **Image provider on Azure.** AI Services `ss-ai-836865` (East US 2) with deployment `gpt-image` (gpt-image-1.5, capacity 20). Locally, `.env.local` has `AZURE_IMAGE_ENDPOINT/KEY/DEPLOYMENT`.
- **Theme.** Warm paper, bold colour per mode, Bricolage Grotesque, handwritten accents, animated spindle mark.
- **Checks:** 36 unit tests, typecheck and lint pass.

**Not done yet (in order):**
1. **UI for the new features.** Characters, Series, Story stills (draw/redraw per scene), Lyrics (song + LRC), API tokens and cast picking work through the API, CLI and MCP but have no screens yet. The workspace still shows only the older flows. Build these screens on the existing endpoints; the CSS classes (`.gallery`, `.char-card`, `.cast-pick`, `.episode`, `.scene-body`, `.still-thumb`) are already in globals.css.
2. **UI polish.** The new theme is applied, but pages keep their old structure. Aryan's review: not yet up to the mark. Redesign the landing, studio home and workspace sections freely, with films placed at a proper size.
3. **Lyric video background.** The paper background does not suit lyrics. Use the song's beat for motion and a darker, coloured or photo/clip background (reuse montage clips or story stills behind the words).
4. **Caption your own reel.** Upload a reel and get word-timed captions placed where they don't cover faces or text. Needs:
   - a transcription adapter (whisper.cpp or Azure Speech) for word times;
   - frame sampling with a safe-zone pick, using the contact sheet plus a vision model, or a simple face and text detector;
   - an option to ask the creator where captions go.

   Same flow in UI, CLI and MCP.
5. **Run `npm run e2e`** (not re-run after this round). Add journeys for Story, Cartoon, Lyrics, Series and tokens.
6. ~~Redeploy~~ **Done 2026-11-04:** version 3 is live with image settings on both apps; the production worker generated a test image. Future redeploys: `bash scripts/azure-deploy.sh`. For reference, the image settings added were:
   - `az containerapp secret set ... --secrets image-key=...`
   - env `AZURE_IMAGE_ENDPOINT=https://ss-ai-836865.cognitiveservices.azure.com`, `AZURE_IMAGE_DEPLOYMENT=gpt-image`, `AZURE_IMAGE_KEY=secretref:image-key`.

   Production now runs version 3.

## 1. Where things stand

- **Live:** https://scenespindle.blackforest-f0b810b6.centralindia.azurecontainerapps.io (Azure Container Apps, Central India).
- **Repo:** this folder. It contains every commit of `Aryanjstar/LEELA` (all branches are ancestors of the current one) plus all work from 2026-11-04, uncommitted. Product name SceneSpindle; planned GitHub repo `Aryanjstar/scenespindle`.
- **Owner account (production, database `scenespindle`):** created for `OWNER_EMAIL`. The password is in `.data/owner-password-scenespindle-*.txt` on the machine that made this zip. The zip leaves out `.data/`, so the file is not included: copy it separately and privately, or make a new password with `MONGODB_DB=scenespindle npm run create-owner -- --rotate`.
- Database and cookie names stay `leela-dev` / `leela_session` for local development on purpose (branding is not a migration).

## 2. On the other machine: commit and push

```bash
unzip scenespindle.zip && cd scenespindle
```

```bash
git status
```

```bash
git switch -c scenespindle-release && git add -A && git commit -m "SceneSpindle: films, Code Lab, Audio, Montage, Azure deployment"
```

```bash
gh repo create Aryanjstar/scenespindle --private --source . --push
```

Then create `.env.local` from `.env.example` (your keys never travel in the zip), `npm ci`, and `npm run check`.

Rotate after this session, because these values were pasted into a chat: Gemini, ElevenLabs, Sarvam and Higgsfield keys, and the Atlas database user's password. After rotating, update the Container Apps secrets (section 4). The production auth pepper is new and was never shared.

## 3. Run and test locally

Needs Node 22+, FFmpeg, Chrome, and a `mongod` binary on PATH (for the e2e suites).

| Command | What it proves |
|---|---|
| `npm run check` | 36 unit tests, typecheck, lint |
| `npm run e2e` | Builds the app, then two browser journeys, each with its own MongoDB replica set, app and worker. |
| `npm run dev` + `npm run worker` | The studio on :3000 against `.env.local` |
| `SCENESPINDLE_TEST_VOICE=1 npm run --silent studio -- render examples/plans/why-ice-floats.json --voice test:tone --out out/smoke` | The renderer, no keys needed |

The two journeys:

- **`browser.mjs`** runs as two creators at 1280 and 390 px:
  - sign in, projects, drafts, briefs, storyboard import, preview, and a real MP4 render;
  - file streaming, sharing (download off/on, revoke), invites, reset, rate limit, soft delete, lease recovery, cancel/retry.
- **`modes.mjs`** covers the newer modes:
  - Audio from an approved exact script; scene-scoped copilot;
  - Code Lab from a browser trace in 1:1; Montage from uploaded demo media in 16:9;
  - restore after delete, cross-creator isolation for clips and films, upload content sniffing, and no overflow at 390 px.

CLI (JSON out, nonzero exit on failure): `doctor`, `capabilities`, `schema`, `validate-plan`, `captions`, `brief`, `trace`, `plan`, `render`, `montage`. Examples are in `examples/`, including rights-free demo media generated with FFmpeg.

## 4. Azure (deployed)

Everything is in resource group `rg-scenespindle` (Central India):

| Resource | Name | Purpose |
|---|---|---|
| Storage account | `ssmedia836865`, private container `media` | Films, posters, captions, uploads. Public access off; viewers get 15-minute signed URLs after an access check. |
| Container registry | `ssacr836865` (Basic) | Images. Each build renders a test film and fails if the renderer is broken. |
| Container Apps environment | `cae-scenespindle` | Hosts both apps. |
| Container App | `scenespindle` | Web, 1 vCPU / 2 GiB, 1 to 2 replicas, external HTTPS. |
| Container App | `scenespindle-worker` | Renders, 2 vCPU / 4 GiB, 1 replica, `npm run worker:prod`. |

Secrets live in Container Apps secrets: `mongo-uri`, `gemini`, `sarvam`, `elevenlabs`, `pepper`, `storage-key`. Production uses database `scenespindle` on your existing Atlas cluster.

**Redeploy** after changes (from the repo, logged in with `az login`):

```bash
bash scripts/azure-deploy.sh
```

**Update a secret** after rotating a key (repeat for `scenespindle-worker`, then restart both):

```bash
az containerapp secret set -n scenespindle -g rg-scenespindle --secrets elevenlabs=NEW_VALUE
```

```bash
az containerapp revision restart -n scenespindle -g rg-scenespindle --revision $(az containerapp revision list -n scenespindle -g rg-scenespindle --query "[0].name" -o tsv)
```

**Logs:** `az containerapp logs show -n scenespindle-worker -g rg-scenespindle --follow`

**Custom domain (optional):** `az containerapp hostname add` plus `az containerapp hostname bind --environment cae-scenespindle --validation-method CNAME`. After binding, update `APP_ORIGIN` on both apps to the new HTTPS URL; mutations from any other origin are refused.

**Mail (optional):** set `RESEND_API_KEY` and `MAIL_FROM` (verified domain) on the web app. Until then, invites and resets are copy-a-link flows in Settings.

**Cost note:** both apps keep one replica warm (the worker polls MongoDB for jobs). Roughly the cost of 3 vCPU running all month plus Basic ACR and a few GB of storage. To pause the studio, set `--min-replicas 0` on both apps (the site sleeps until visited; renders wait until the worker is scaled back up).

**Vercel:** no longer the target. The old `leela` Vercel project still serves the earlier public page; you can delete it.

## 5. What was verified

All on 2026-11-04:

- **Local suites:** unit, type, lint and both browser journeys pass (see section 3).
- **Live providers:**
  - Gemini plans in English, Hindi (16:9) and Hinglish; Code Lab narration whose numbers match the recorded run.
  - ElevenLabs narration with provider word timings.
  - A Sarvam Hindi film that passed QA.
- **Frame sheets** were inspected for every new film kind:
  - captions enlarged after review;
  - Hindi uses a Devanagari font with localized diagram labels;
  - Code Lab shows the code, the array with lo/mid/hi, and the call stack;
  - kinetic type shows one word at a time;
  - montage cuts land on beats (120 BPM detected on a 120 BPM track).
- **Worker crash:** killed mid-render. The previous film stayed current and the job was reclaimed and finished.
- **Azure Blob driver, against the real storage account:**
  - upload, signed URL with byte ranges and download name;
  - anonymous access refused, byte-identical round trip, prefix delete.
- **Production:**
  - the image self-test passed in the cloud build;
  - a narrated Code Lab film rendered inside the live worker (ElevenLabs, -14.5 LUFS, QA passed);
  - the health check reaches the database;
  - from outside: no session gives 401, a foreign origin gives 403, an unknown sign-in gives a generic 401, forged tokens and paths give 404.
- **Not verified:**
  - a signed-in browser session on production. I did not enter the production password. Sign in once, render one film and share it to confirm.
  - Resend mail delivery.
  - Sarvam on production.

## 6. What the product does now

- **Modes:** Explainer, Code Lab (films drawn from a real browser trace), Audio (kinetic words on measured speech), Montage (your photos and clips cut on the beats of your music).
- **Formats and languages:** 9:16, 16:9, 1:1. English, Hindi, Hinglish.
- **Brief:** an approved brief drives planning. Exact scripts are kept verbatim; the AI only adds on-screen text and visuals.
- **Copilot:** proposes changes you keep or discard. Tick scenes to limit a change to them. Unchanged narration is reused from cache, so it isn't re-recorded or re-billed.
- **Rendering:** narration, word-timed captions, -14 LUFS mix, poster, frame sheet, SRT/VTT, automatic QA. Only a QA-passed film becomes current.
- **Viewing and sharing:** versions, downloads, share links (optional download, revoke), private streaming.
- **Accounts:** invites, password reset (owner link or email), rate limits, per-creator isolation.
- **Projects:** soft delete with 7-day restore, then automatic erase of the project and its films.
- **Allowances:** monthly ledger for voice characters and planner calls; work stops when one is used up.

## 7. Still open

These remain switched off in the catalog:

1. **Story and Cartoon:** need an image provider and character art with recorded rights.
2. **Series** with a versioned bible and episodes; **3D** (Three.js or Blender).
3. **Paired PC worker** with scoped tokens; **OTIO export**; **subject cutouts**.
4. **Publishing** to YouTube and Instagram (needs your OAuth apps); static banner and profile tools.
5. **Brief research** step (web sources) and series-scope briefs.
6. **Video craft:** layouts can leave space empty, and planner slam words can be weak. Score a few films and tune `src/compiler/compile.ts`.
7. **Voice cache** is per container and resets on restart. Moving it to Blob storage would make re-renders after a deploy free too.

## 8. Notes

- The original `create-owner` script overwrote `.data/owner-password.txt` (the local dev owner's password for Atlas `leela-dev`). Recover with `npm run create-owner -- --rotate`. The script now never overwrites.
- PRD, ARCHITECTURE, DATABASE and API docs were not edited, per AGENTS.md. New runtime dependencies: `hyperframes@0.8.176` (the renderer ARCHITECTURE.md names) and `@fontsource/anek-devanagari` (OFL font for Hindi films). TypeScript is pinned to 6.0.3 for typescript-eslint.
- UI craft follows unslop by Damir Sokolovsky (CC BY 4.0); credit is in `src/app/globals.css`.
