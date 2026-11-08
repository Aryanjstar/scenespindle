## What this does

Finishes and fixes the studio after the Nov 5 work. Audit of `dbbe4d7` found projects that could stay "busy" forever, broken Story previews, dead image code, a cast that never showed on screen, and many screens that could not finish their flow. All fixed; the remaining release gates are built except social publishing.

**Backend**
- Every job (planning, copilot, stills, renders, reel captions, style learning, exports, tools) runs in the worker on one lease runner with a max-attempt sweep, cancel and retry.
- Usage is reserved before a call, settled on success, released on failure; the owner can cap each creator.
- New API: account and password change, sessions, invite resend, duplicate, scene regenerate, storyboard versions and restore, make current, share download toggle, capabilities, voice samples, trace read, series briefs, brief research with sources, resumable uploads, asset delete, exports (audio, package zip, OTIO), paired PC agents, banners and profile copy, job queue.

**Films**
- Story and Cartoon: per-character looks, ten sets, eight actions, shot sizes, speaker-only lip sync; illustrated stills as a look; Blender cinematic 3D on a paired PC.
- Montage styles from the Claude Edits toolkit (vlog, tutorial, cinematic), learned styles from uploaded references, CC0 edit sounds.
- Caption a reel (heard or pasted timing, placement away from faces) and a Karaoke lyrics style built to the creator's lyric-video notes.
- Code Lab traces JavaScript as well as Python, still only in the browser.

**Screens**: studio home, workspace, library (files, characters, styles), series, tools, queue, settings, command palette; every action has a pending state and a visible error.

**Home page**: every film is click-to-play with sound, plays once, and pauses any other film; nothing downloads before a click; films re-encoded at 720p fast start and cached for a year; new Paper boat and Tikku films; spindle favicon.

## How it was checked
- 55 unit tests, typecheck, lint.
- `npm run e2e`: three journeys pass (two creators at 1280 and 390 px; all modes; every new screen, including no sideways scroll at 390 px).
- Frame sheets reviewed for: two-character stage Story, illustrated Story, JavaScript Code Lab, vlog montage, lyrics, reel captions, karaoke lyric video (-17.7 LUFS, peak -4.0 dB), Blender Story via a paired PC. OTIO output loads in OpenTimelineIO 0.17.
- Docker build now renders a 3D stage film (fails on a black frame) and smoke-tests the bundled whisper.cpp.
- Production already runs this branch on Azure.

## Not in this PR
YouTube and Instagram publishing (needs OAuth apps). ElevenLabs is out of credits on the current account; transcription falls back to whisper.cpp, which the container image now includes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
