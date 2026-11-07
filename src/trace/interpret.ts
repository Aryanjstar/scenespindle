export type TraceStep = {
  line: number;
  event: "call" | "line" | "return";
  stack: { name: string; locals: Record<string, string | number | number[] | null> }[];
};

export type TraceResult = {
  steps: TraceStep[];
  returned: number | null;
  summary: { callCount: number; maxDepth: number; variables: string[] };
};

type Expr =
  | { kind: "num"; value: number }
  | { kind: "name"; name: string }
  | { kind: "index"; name: string; index: Expr }
  | { kind: "bin"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] };

type Stmt =
  | { kind: "assign"; name: string; expr: Expr; line: number }
  | { kind: "return"; expr: Expr; line: number }
  | { kind: "if"; test: Expr; yes: Stmt[]; no: Stmt[]; line: number }
  | { kind: "while"; test: Expr; body: Stmt[]; line: number }
  | { kind: "expr"; expr: Expr; line: number };

type Fn = { name: string; params: string[]; body: Stmt[] };

const CAP = 2000;

export function traceProgram(source: string, entry: string, input: unknown[]): TraceResult {
  if (/\bimport\b|\b__|\beval\b|\bFunction\b/.test(source)) {
    throw new Error("That code is not allowed in the sandbox.");
  }
  const fns = parse(source);
  const target = fns.find((fn) => fn.name === entry);
  if (!target) throw new Error(`No function named ${entry}.`);
  const steps: TraceStep[] = [];
  const frames: { name: string; locals: Record<string, string | number | number[] | null>; fn: Fn; ip: number }[] = [];
  let returned: number | null = null;
  let callCount = 0;
  let maxDepth = 0;

  function snapshot() {
    return frames.map((frame) => ({
      name: frame.name,
      locals: Object.fromEntries(
        Object.entries(frame.locals).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 64) : value]),
      ),
    }));
  }

  function pushStep(line: number, event: TraceStep["event"]) {
    if (steps.length >= CAP) throw new Error("Stopped at 2,000 steps.");
    steps.push({ line, event, stack: snapshot() });
  }

  function lookup(name: string): string | number | number[] | null {
    for (let i = frames.length - 1; i >= 0; i--) {
      if (name in frames[i].locals) return frames[i].locals[name];
    }
    throw new Error(`Unknown name ${name}.`);
  }

  function evalExpr(expr: Expr, line: number): string | number | number[] | null {
    if (expr.kind === "num") return expr.value;
    if (expr.kind === "name") return lookup(expr.name);
    if (expr.kind === "index") {
      const list = lookup(expr.name);
      const index = evalExpr(expr.index, line);
      if (!Array.isArray(list) || typeof index !== "number") throw new Error("Index needs a list.");
      return list[index] ?? null;
    }
    if (expr.kind === "call") {
      if (expr.name === "len") {
        const value = evalExpr(expr.args[0], line);
        return Array.isArray(value) ? value.length : String(value ?? "").length;
      }
      const fn = fns.find((item) => item.name === expr.name);
      if (!fn) throw new Error(`Unknown function ${expr.name}.`);
      const args = expr.args.map((arg) => evalExpr(arg, line));
      return call(fn, args, line);
    }
    const left = evalExpr(expr.left, line);
    const right = evalExpr(expr.right, line);
    if (expr.op === "+") return Number(left) + Number(right);
    if (expr.op === "-") return Number(left) - Number(right);
    if (expr.op === "*") return Number(left) * Number(right);
    if (expr.op === "//") { if (Number(right) === 0) throw new Error("Division by zero."); return Math.floor(Number(left) / Number(right)); }
    if (expr.op === "/") { if (Number(right) === 0) throw new Error("Division by zero."); return Number(left) / Number(right); }
    if (expr.op === "%") { if (Number(right) === 0) throw new Error("Division by zero."); return ((Number(left) % Number(right)) + Number(right)) % Number(right); }
    if (expr.op === "!=") return Number(left) !== Number(right) ? 1 : 0;
    if (expr.op === "and") return left && right ? 1 : 0;
    if (expr.op === "or") return left || right ? 1 : 0;
    if (expr.op === "==") return Number(left) === Number(right) ? 1 : 0;
    if (expr.op === "<=") return Number(left) <= Number(right) ? 1 : 0;
    if (expr.op === ">=") return Number(left) >= Number(right) ? 1 : 0;
    if (expr.op === "<") return Number(left) < Number(right) ? 1 : 0;
    if (expr.op === ">") return Number(left) > Number(right) ? 1 : 0;
    throw new Error(`Unknown operator ${expr.op}.`);
  }

  function call(fn: Fn, args: (string | number | number[] | null)[], line: number): number | null {
    callCount += 1;
    const locals: Record<string, string | number | number[] | null> = {};
    fn.params.forEach((name, index) => {
      locals[name] = args[index] ?? null;
    });
    frames.push({ name: fn.name, locals, fn, ip: 0 });
    maxDepth = Math.max(maxDepth, frames.length);
    pushStep(line, "call");
    try {
      return runFrame();
    } catch (error) {
      if (error && typeof error === "object" && "__return" in error) return (error as { __return: number | null }).__return;
      throw error;
    }
  }

  function runFrame(): number | null {
    const frame = frames[frames.length - 1];
    while (frame.ip < frame.fn.body.length) {
      const stmt = frame.fn.body[frame.ip];
      frame.ip += 1;
      pushStep(stmt.line, "line");
      if (stmt.kind === "assign") {
        frame.locals[stmt.name] = evalExpr(stmt.expr, stmt.line);
      } else if (stmt.kind === "expr") {
        evalExpr(stmt.expr, stmt.line);
      } else if (stmt.kind === "return") {
        const value = evalExpr(stmt.expr, stmt.line);
        pushStep(stmt.line, "return");
        frames.pop();
        return typeof value === "number" ? value : null;
      } else if (stmt.kind === "while") {
        let guard = 0;
        while (evalExpr(stmt.test, stmt.line)) {
          guard += 1;
          if (guard > CAP) throw new Error("Stopped at 2,000 steps.");
          runBlock(stmt.body);
        }
      } else if (stmt.kind === "if") {
        if (evalExpr(stmt.test, stmt.line)) runBlock(stmt.yes);
        else runBlock(stmt.no);
      }
    }
    pushStep(frame.fn.body.at(-1)?.line ?? 1, "return");
    frames.pop();
    return null;
  }

  function runBlock(body: Stmt[]) {
    const saved = frames[frames.length - 1].fn;
    const ip = frames[frames.length - 1].ip;
    frames[frames.length - 1].fn = { ...saved, body };
    frames[frames.length - 1].ip = 0;
    const nested = frames[frames.length - 1];
    while (nested.ip < nested.fn.body.length) {
      const stmt = nested.fn.body[nested.ip];
      nested.ip += 1;
      pushStep(stmt.line, "line");
      if (stmt.kind === "assign") nested.locals[stmt.name] = evalExpr(stmt.expr, stmt.line);
      else if (stmt.kind === "return") {
        const value = evalExpr(stmt.expr, stmt.line);
        pushStep(stmt.line, "return");
        frames.pop();
        throw { __return: typeof value === "number" ? value : null };
      } else if (stmt.kind === "while") {
        let guard = 0;
        while (evalExpr(stmt.test, stmt.line)) {
          guard += 1;
          if (guard > CAP) throw new Error("Stopped at 2,000 steps.");
          runBlock(stmt.body);
        }
      } else if (stmt.kind === "if") {
        if (evalExpr(stmt.test, stmt.line)) runBlock(stmt.yes);
        else runBlock(stmt.no);
      } else if (stmt.kind === "expr") evalExpr(stmt.expr, stmt.line);
    }
    frames[frames.length - 1].fn = saved;
    frames[frames.length - 1].ip = ip;
  }

  const args = input.map((item) => {
    if (typeof item === "number") return item;
    if (Array.isArray(item) && item.every((part) => typeof part === "number")) return item as number[];
    throw new Error("Inputs must be numbers or lists of numbers.");
  });
  try {
    returned = call(target, args, target.body[0]?.line ?? 1);
  } catch (error) {
    if (error && typeof error === "object" && "__return" in error) {
      returned = (error as { __return: number | null }).__return;
    } else {
      throw error;
    }
  }
  const variables = new Set<string>();
  for (const step of steps) for (const frame of step.stack) for (const key of Object.keys(frame.locals)) variables.add(key);
  return { steps, returned, summary: { callCount, maxDepth, variables: [...variables] } };
}

function parse(source: string): Fn[] {
  const lines = source.split("\n").map((text, index) => ({
    n: index + 1,
    indent: text.match(/^\s*/)?.[0].length ?? 0,
    text: text.trim(),
  })).filter((line) => line.text && !line.text.startsWith("#"));
  let i = 0;
  const fns: Fn[] = [];
  while (i < lines.length) {
    const line = lines[i];
    const header = line.text.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:$/);
    if (!header) throw new Error(`Line ${line.n}: expected a def.`);
    i += 1;
    const body: Stmt[] = [];
    while (i < lines.length && lines[i].indent > line.indent) {
      const parsed = parseStmt(lines, i, line.indent);
      body.push(parsed.stmt);
      i = parsed.next;
    }
    fns.push({ name: header[1], params: header[2].split(",").map((part) => part.trim()).filter(Boolean), body });
  }
  return fns;
}

function parseStmt(lines: { n: number; indent: number; text: string }[], start: number, parentIndent: number): { stmt: Stmt; next: number } {
  const line = lines[start];
  if (line.indent <= parentIndent) throw new Error(`Line ${line.n}: bad indent.`);
  const ret = line.text.match(/^return\s+(.+)$/);
  if (ret) return { stmt: { kind: "return", expr: parseExpr(ret[1]), line: line.n }, next: start + 1 };
  const augmented = line.text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*([+\-*])=\s*(.+)$/);
  if (augmented) return { stmt: { kind: "assign", name: augmented[1], expr: parseExpr(`${augmented[1]} ${augmented[2]} (${augmented[3]})`), line: line.n }, next: start + 1 };
  const assign = line.text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if (assign && !line.text.includes("==")) return { stmt: { kind: "assign", name: assign[1], expr: parseExpr(assign[2]), line: line.n }, next: start + 1 };
  if (line.text.startsWith("while ") && line.text.endsWith(":")) {
    const body: Stmt[] = [];
    let i = start + 1;
    while (i < lines.length && lines[i].indent > line.indent) {
      const parsed = parseStmt(lines, i, line.indent);
      body.push(parsed.stmt);
      i = parsed.next;
    }
    return { stmt: { kind: "while", test: parseExpr(line.text.slice(6, -1).trim()), body, line: line.n }, next: i };
  }
  if (line.text.startsWith("if ") && line.text.endsWith(":")) return parseIf(lines, start, line.text.slice(3, -1).trim());
  const loop = line.text.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+range\((.+)\):$/);
  if (loop) {
    // for i in range(a, b): becomes i = a, then while i < b with i = i + 1 at the end of the body.
    const parts = loop[2].split(",").map((part) => part.trim());
    const [from, to] = parts.length === 1 ? ["0", parts[0]] : [parts[0], parts[1]];
    const body: Stmt[] = [];
    let i = start + 1;
    while (i < lines.length && lines[i].indent > line.indent) {
      const parsed = parseStmt(lines, i, line.indent);
      body.push(parsed.stmt);
      i = parsed.next;
    }
    body.push({ kind: "assign", name: loop[1], expr: parseExpr(`${loop[1]} + 1`), line: line.n });
    const init: Stmt = { kind: "assign", name: loop[1], expr: parseExpr(from), line: line.n };
    return { stmt: { kind: "if", test: { kind: "num", value: 1 }, yes: [init, { kind: "while", test: parseExpr(`${loop[1]} < ${to}`), body, line: line.n }], no: [], line: line.n }, next: i };
  }
  return { stmt: { kind: "expr", expr: parseExpr(line.text), line: line.n }, next: start + 1 };
}

/** if / elif / else chain at one indent; each elif becomes an if inside the else branch. */
function parseIf(lines: { n: number; indent: number; text: string }[], start: number, test: string): { stmt: Stmt; next: number } {
  const line = lines[start];
  const block = (from: number) => {
    const body: Stmt[] = [];
    let i = from;
    while (i < lines.length && lines[i].indent > line.indent) {
      const parsed = parseStmt(lines, i, line.indent);
      body.push(parsed.stmt);
      i = parsed.next;
    }
    return { body, next: i };
  };
  const yes = block(start + 1);
  let i = yes.next;
  let no: Stmt[] = [];
  if (i < lines.length && lines[i].indent === line.indent) {
    const elif = lines[i].text.match(/^elif\s+(.+):$/);
    if (elif) {
      const nested = parseIf(lines, i, elif[1].trim());
      no = [nested.stmt];
      i = nested.next;
    } else if (lines[i].text === "else:") {
      const other = block(i + 1);
      no = other.body;
      i = other.next;
    }
  }
  return { stmt: { kind: "if", test: parseExpr(test), yes: yes.body, no, line: line.n }, next: i };
}

function parseExpr(input: string): Expr {
  const tokens = input.match(/<=|>=|==|!=|\/\/|\d+|[a-zA-Z_][a-zA-Z0-9_]*|[()[\],+\-*/%<>]/g) ?? [];
  let at = 0;
  const expr = parseOr();
  if (at !== tokens.length) throw new Error(`Could not read "${input}".`);
  return expr;

  function peek() { return tokens[at]; }
  function eat(value?: string) {
    const token = tokens[at];
    if (value && token !== value) throw new Error(`Expected ${value} in "${input}".`);
    at += 1;
    return token;
  }
  function parseOr(): Expr {
    let left = parseAnd();
    while (peek() === "or") { eat(); left = { kind: "bin", op: "or", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd(): Expr {
    let left = parseNot();
    while (peek() === "and") { eat(); left = { kind: "bin", op: "and", left, right: parseNot() }; }
    return left;
  }
  function parseNot(): Expr {
    if (peek() === "not") { eat(); return { kind: "bin", op: "==", left: parseNot(), right: { kind: "num", value: 0 } }; }
    return parseCmpTop();
  }
  // Comparisons bind looser than arithmetic: lo <= hi, arr[mid] == target, a + 1 < b.
  function parseCmpTop(): Expr {
    let left = parseAdd();
    while (["==", "!=", "<=", ">=", "<", ">"].includes(peek())) { const op = eat(); left = { kind: "bin", op, left, right: parseAdd() }; }
    return left;
  }
  function parseAdd(): Expr {
    let left = parseMul();
    while (peek() === "+" || peek() === "-") {
      const op = eat();
      left = { kind: "bin", op, left, right: parseMul() };
    }
    return left;
  }
  function parseMul(): Expr {
    let left = parseCmp();
    while (peek() === "*" || peek() === "//" || peek() === "/" || peek() === "%") {
      const op = eat();
      left = { kind: "bin", op, left, right: parseCmp() };
    }
    return left;
  }
  function parseCmp(): Expr {
    let left = parsePrimary();
    return left;
  }
  function parsePrimary(): Expr {
    const token = eat();
    if (token === "-") {
      const inner = parsePrimary();
      return inner.kind === "num" ? { kind: "num", value: -inner.value } : { kind: "bin", op: "-", left: { kind: "num", value: 0 }, right: inner };
    }
    if (/^\d+$/.test(token)) return { kind: "num", value: Number(token) };
    if (token === "(") {
      const inner = parseOr();
      eat(")");
      return inner;
    }
    if (peek() === "(") {
      eat("(");
      const args: Expr[] = [];
      if (peek() !== ")") {
        args.push(parseOr());
        while (peek() === ",") {
          eat(",");
          args.push(parseOr());
        }
      }
      eat(")");
      return { kind: "call", name: token, args };
    }
    if (peek() === "[") {
      eat("[");
      const index = parseOr();
      eat("]");
      return { kind: "index", name: token, index };
    }
    return { kind: "name", name: token };
  }
}
