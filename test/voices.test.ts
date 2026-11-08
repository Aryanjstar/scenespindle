import test from "node:test";
import assert from "node:assert/strict";
import { escapeSsml, splitSpeechFrame, wordsFromMetadata } from "../src/server/providers/azure-speech.js";

test("Azure word boundaries become caption times, and speech text is escaped", () => {
  const words = wordsFromMetadata(JSON.stringify({
    Metadata: [
      { Type: "WordBoundary", Data: { Offset: 5_000_000, Duration: 3_000_000, text: { Text: "Paper" } } },
      { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 1, text: { Text: "skip" } } },
      { Type: "WordBoundary", Data: { Offset: 8_000_000, Duration: 2_000_000, text: { Text: "boat" } } },
    ],
  }));
  assert.deepEqual(words, [
    { text: "Paper", startMs: 500, endMs: 800 },
    { text: "boat", startMs: 800, endMs: 1000 },
  ]);
  assert.equal(escapeSsml(`A <b> & "boat"`), "A &lt;b&gt; &amp; &quot;boat&quot;");
  const frame = splitSpeechFrame("Path: audio.metadata\r\nX-RequestId: abc\r\n\r\n{\"ok\":true}");
  assert.equal(frame.headers.path, "audio.metadata");
  assert.equal(frame.body, "{\"ok\":true}");
});
