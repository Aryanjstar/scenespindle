# S1 Render

**Date:** 2026-10-19
**Question:** Can a scene-graph JSON compile to a HyperFrames composition and render a 1080×1920 MP4 with word-highlight captions?

## What was tried

Gemini filled a closed storyboard. Trusted code expanded it into a plan, checked it, voiced each line, and compiled escaped HTML plus a GSAP timeline. HyperFrames 0.8.176 rendered it on this M2.

Sample: `spikes/s1-render/out/why-the-moon-misses.mp4`

- 1080×1920, 30 fps, H.264 + AAC
- 40.8 s (narration measured, not padded to 45)
- Render time: 49 s (draft), under the 3 minute gate
- Lint: 0 errors, 22 warnings (Studio wants sub-compositions; the film still renders)
- Loudness after normalisation: −14.5 LUFS, true peak −1.4 dBTP, 48 kHz stereo
- Word timings: ElevenLabs character alignment, 100% of spoken tokens matched before compile

Captions sit in the lower band with an ink outline, not a pill. The active word goes to full opacity. Times come from the voice provider. They were not re-measured with a second aligner, so the ±150 ms gate is met by construction and still needs an ear check.

## Decision

HyperFrames stays the renderer. The compiler emits one composition. Splitting scenes into sub-compositions is a follow-up, not a reason to switch to Remotion.

## Human score

Pending. Watch the MP4.
