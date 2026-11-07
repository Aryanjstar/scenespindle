import type { TraceStep } from "./interpret";

/**
 * Visual states derived by trusted code from a recorded execution trace.
 * The model never writes these values; it only chooses which range of states
 * a scene shows.
 */
export type TraceState = {
  line: number;
  /** The line whose execution produced these values (the step before this one). */
  after?: number;
  event: "call" | "line" | "return";
  array: number[] | null;
  arrayName: string | null;
  pointers: [string, number][];
  scalars: [string, number | string][];
  stack: string[];
};

const POINTER = /^(lo|hi|mid|low|high|left|right|i|j|k|l|r|start|end|p|q|pivot)$/;
export const MAX_STATES = 40;

function frameLabel(frame: TraceStep["stack"][number]): string {
  const args = Object.entries(frame.locals)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `${frame.name}(${args})`.slice(0, 40);
}

export function stateOf(step: TraceStep): TraceState {
  const top = step.stack[step.stack.length - 1];
  const locals = top?.locals ?? {};
  let array: number[] | null = null;
  let arrayName: string | null = null;
  for (const [name, value] of Object.entries(locals)) {
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
      array = value.slice(0, 16);
      arrayName = name;
      break;
    }
  }
  const pointers: [string, number][] = [];
  const scalars: [string, number | string][] = [];
  for (const [name, value] of Object.entries(locals)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (array && POINTER.test(name) && Number.isInteger(value) && value >= 0 && value < array.length) pointers.push([name, value]);
      scalars.push([name, value]);
    } else if (typeof value === "string") {
      scalars.push([name, value.slice(0, 24)]);
    }
  }
  return {
    line: step.line,
    event: step.event,
    array,
    arrayName,
    pointers: pointers.slice(0, 4),
    scalars: scalars.slice(0, 5),
    stack: step.stack.slice(-6).map(frameLabel),
  };
}

function signature(state: TraceState): string {
  return JSON.stringify([state.array, state.pointers, state.scalars, state.stack]);
}

/** Keep the states where something visible changed, capped and evenly sampled. */
export function keyStates(steps: TraceStep[]): TraceState[] {
  const out: TraceState[] = [];
  let last = "";
  let previousLine: number | undefined;
  for (const step of steps) {
    if (!step || !Array.isArray(step.stack) || step.stack.length === 0) continue;
    // A step shows values just before its own line runs, so a change was made by the line before.
    const state = { ...stateOf(step), after: previousLine };
    previousLine = step.line;
    const sig = signature(state);
    if (sig === last) continue;
    last = sig;
    out.push(state);
  }
  if (out.length <= MAX_STATES) return out;
  const picked: TraceState[] = [];
  for (let i = 0; i < MAX_STATES; i++) picked.push(out[Math.round((i * (out.length - 1)) / (MAX_STATES - 1))]);
  return picked;
}

/** A factual, code-written description of the run for the planner and for offline narration. */
export function describeRun(entry: string, input: unknown, states: TraceState[], returned: unknown): string[] {
  const facts: string[] = [`Call ${entry}(${JSON.stringify(input).slice(1, -1).slice(0, 120)}).`];
  for (const state of states.slice(0, 24)) {
    const vars = state.scalars.map(([key, value]) => `${key}=${value}`).join(", ");
    if (state.event === "call") facts.push(`Enter ${state.stack[state.stack.length - 1]}.`);
    else if (state.event === "return") facts.push(`Return from ${state.stack[state.stack.length - 1]}.`);
    else if (vars) facts.push(state.after ? `After line ${state.after} runs: ${vars}.` : `At line ${state.line}: ${vars}.`);
  }
  if (returned !== undefined && returned !== null) facts.push(`It returns ${JSON.stringify(returned)}.`);
  return facts;
}
