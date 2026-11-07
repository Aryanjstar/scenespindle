#!/usr/bin/env bash
# Synthesize the studio's edit sounds with FFmpeg. Self-made, no samples: released CC0.
# swish (chapter change), click (cut), pop (text in), chime (outro).
# Usage: bash scripts/make-sfx.sh [out_dir]   (default library/sfx)
set -euo pipefail
OUT="${1:-library/sfx}"; mkdir -p "$OUT"
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.28:c=pink:a=0.9:seed=7" -af "highpass=f=600,lowpass=f=6000,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.16,volume=0.7" -ar 48000 -ac 2 "$OUT/swish.wav"
ffmpeg -v error -y -f lavfi -i "sine=f=2400:d=0.035:sample_rate=48000" -af "afade=t=out:d=0.035,volume=0.6" -ac 2 "$OUT/click.wav"
ffmpeg -v error -y -f lavfi -i "sine=f=660:d=0.18:sample_rate=48000" -af "afade=t=out:d=0.18,volume=0.5" -ac 2 "$OUT/pop.wav"
ffmpeg -v error -y -f lavfi -i "sine=f=1318:d=1.2:sample_rate=48000" -f lavfi -i "sine=f=1760:d=1.2:sample_rate=48000" -filter_complex "amix=inputs=2,afade=t=out:d=1.2,volume=0.6" -ac 2 "$OUT/chime.wav"
