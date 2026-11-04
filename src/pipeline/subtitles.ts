import { groupCaptions, type Caption } from "../cli/captions";
import type { Timeline } from "../compiler/compile";

/** Absolute word times for the whole film, from the measured timeline. */
export function filmWords(timeline: Timeline) {
  return timeline.lines.flatMap((line) =>
    line.words.map((word) => ({ text: word.text, startMs: line.startMs + word.startMs, endMs: line.startMs + word.endMs })),
  );
}

/** Phrase captions grouped per line, so a caption never spans two narration lines. */
export function filmCaptions(timeline: Timeline, maxWords = 6): Caption[] {
  return timeline.lines.flatMap((line) => {
    const words = line.words.map((word) => ({ text: word.text, startMs: line.startMs + word.startMs, endMs: line.startMs + word.endMs }));
    // Clamp tiny overlaps from provider rounding so grouping accepts them.
    for (let i = 1; i < words.length; i++) if (words[i].startMs < words[i - 1].endMs) words[i].startMs = words[i - 1].endMs;
    for (const word of words) if (word.endMs <= word.startMs) word.endMs = word.startMs + 1;
    return words.length ? groupCaptions(words, maxWords) : [];
  });
}

function stamp(ms: number, separator: "," | "."): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const rest = total % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(rest, 3)}`;
}

function clean(text: string): string {
  return text.replaceAll(/\r?\n/g, " ").replaceAll("-->", "->").trim();
}

export function toSrt(captions: Caption[]): string {
  return captions
    .map((caption, index) => `${index + 1}\n${stamp(caption.startMs, ",")} --> ${stamp(caption.endMs, ",")}\n${clean(caption.text)}\n`)
    .join("\n");
}

export function toVtt(captions: Caption[]): string {
  return `WEBVTT\n\n${captions
    .map((caption) => `${stamp(caption.startMs, ".")} --> ${stamp(caption.endMs, ".")}\n${clean(caption.text)}\n`)
    .join("\n")}`;
}
