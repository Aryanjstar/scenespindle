---
name: scenespindle-edit-style
description: The creator's standing editing preferences for montages, reels and lyric videos made in SceneSpindle (or by hand with HyperFrames). Use whenever editing their own clips, choosing fonts, or making a karaoke lyric video.
---

# Creator editing preferences

These come from the creator's own finished edits. Their per-edit instructions always win over these and over any template default.

## Always
- Polished, "aesthetic" Instagram look. Minimal: few elements, small elegant text, lots of breathing room.
- The most aesthetic fonts, never defaults. Shortlist (OFL, bundled in the studio): Instrument Serif, Playfair Display, Pinyon Script, Great Vibes, Caveat, Inter / Inter Black with -5 to -7% tracking, Bricolage Grotesque. One display face plus one tight sans; at most 2 to 3 families.
- Export vertical 1080x1920 MP4 unless asked otherwise.
- Legibility: a soft dark gradient behind text, never a white or cream pill box. No em dashes on screen.

## Day-in-my-life vlog (Montage style `vlog-day@1`)
Hook title (serif, lavender) with a handwritten subtitle, VLOG badge, chapter list with the current chapter in red, time and activity labels, micro-cuts on the beat (0.3 to 0.8 s), a sound on every cut, script "Good Night" ending. Built from the Claude Edits toolkit analysis (`docs/reference/CLAUDE_EDITS_TOOLKIT.md`).

## Karaoke lyric video (Caption a reel, style "Karaoke lyrics")
For a single-take phone video of the creator singing (often a Hindi cover, at night).
- Lyrics only on screen: no titles, tags, names or other text.
- English letters only (romanized Hinglish), all lowercase. Ask the creator to confirm lines Whisper heard doubtfully; never show the raw transcript.
- One line at a time, never wrapped (white-space: nowrap).
- Placement: the empty space above the head, centered; on 1080x1920 the line box top is about 330 px, 120 px tall, 60 px side margins. Never over the face or a face filter.
- Size: small and elegant, 58 px. (116 px was too big; 84 px Hindi below the face was rejected.)
- Font: Instrument Serif italic, line-height 1, letter-spacing -0.015em.
- Colour: gradient text at 100deg, #ffe3b3 to #ffb3c7 to #e9b8ff, with drop-shadow(0 0 10px rgba(255,140,170,.5)) and drop-shadow(0 2px 6px rgba(0,0,0,.6)). A dark gradient over the top of the frame, rgba(12,6,14,.62) fading out by about 640 px.
- Motion: unsung words at opacity 0.28; each word to full opacity with a 3 px lift when sung (word times from the singing). Line in: blur 8 px to 0, rise 16 px, fade, 0.4 s. Line out: fade, rise 12 px, blur 6 px, 0.24 s, just before the next line. Slow push-in on the footage, scale 1.0 to 1.07 over the whole video.
- Footage: warm night grade with lifted shadows (HyperFrames "night-lift" 0.8, blacks +0.06, temperature +0.05 by hand; the studio uses an FFmpeg equivalent), vignette about 0.28, light film grain about 0.12.
- Audio: the creator's own singing, raised to about -17.6 LUFS with peaks near -4 dB, no clipping (two-pass loudness).
