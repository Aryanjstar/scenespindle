import { traceProgram } from "./interpret";
import { jsToPython } from "./js";

// Runs only in a dedicated Web Worker in the creator's browser: no DOM, and network is removed.
const scope = self as unknown as Record<string, unknown>;
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches"]) {
  try { scope[name] = undefined; } catch { /* read-only in some browsers */ }
}

self.onmessage = ({ data }) => {
  try {
    if (data.language === "javascript") {
      const { python, lineMap } = jsToPython(String(data.code));
      const result = traceProgram(python, data.entry, data.input);
      // Steps point at the JavaScript the creator wrote, not the translation.
      for (const step of result.steps) step.line = lineMap[step.line - 1] ?? step.line;
      self.postMessage({ result });
    } else {
      self.postMessage({ result: traceProgram(data.code, data.entry, data.input) });
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Trace failed." });
  }
};
