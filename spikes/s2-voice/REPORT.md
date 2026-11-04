# S2 Voice and timing

**Date:** 2026-10-19

## What was tried

| Path | Result |
|---|---|
| ElevenLabs library voices Zara, Anika, Tripti | Found in the public library. The free API refused them: `paid_plan_required`. |
| ElevenLabs premade voice | **Alice** (Clear, Engaging Educator, British, female). Used for the reel. Character timestamps covered every spoken word. |
| Sarvam Bulbul v3, speaker `priya`, Hindi | Succeeded. Sample: `spikes/s2-voice/out/hindi.wav`. Sarvam returns audio only, no word times. |
| Kokoro local | Not run. HyperFrames can host it later. |
| Azure Speech | Not used. Gemini and the two voice keys were enough. |

ElevenLabs free is non-commercial. This reel is a private proof. Sarvam free credits are commercial-ok, which is the Indian voice the product should keep once alignment exists.

## Decision

English proof voice: ElevenLabs Alice, timings native. Indian voice to keep: Sarvam Bulbul v3. Do not ship Zara, Anika, or Tripti until the ElevenLabs plan can call library voices. Do not silently swap voices.

## Human score

Pending for both Alice and the Hindi sample. The pass needs a 4/5 from you.
