import type { traceProgram } from "./interpret";

/** Trace code in a Web Worker in this browser: 5 second wall clock, 2,000 step cap. */
export function runBrowserTrace(code: string, entry: string, input: unknown[], language: "python" | "javascript" = "python") {
  return new Promise<ReturnType<typeof traceProgram>>((resolve, reject) => {
    const worker = new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("The trace ran longer than five seconds. Try a smaller input."));
    }, 5000);
    function finish() {
      clearTimeout(timeout);
      worker.terminate();
    }
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("The trace worker stopped."));
    };
    worker.postMessage({ code, entry, input, language });
  });
}
