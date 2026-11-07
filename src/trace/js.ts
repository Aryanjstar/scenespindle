/**
 * JavaScript front end for the browser tracer. A small, readable subset of JavaScript is turned
 * into the same statement forms the Python tracer runs, with each generated line mapped back to
 * its JavaScript line, so the film highlights the code the creator wrote. Supported: function
 * declarations, let/const/var, assignment (+=, -=, *=, ++, --), return, while, for (let i = a;
 * i < b; i++), if / else if / else, arrays, .length, Math.floor, ===, !==, &&, ||, !.
 * Anything else is refused with a line number; nothing is evaluated with eval or new Function.
 */
export type Translated = { python: string; lineMap: number[] };

function expr(raw: string, line: number): string {
  let e = raw.trim();
  if (/\b(eval|Function|import|require|globalThis|window|self|document|fetch|this|new)\b|=>|`/.test(e)) throw new Error(`Line ${line}: that is not allowed in the sandbox.`);
  e = e.replace(/Math\.floor\(([^()]*(?:\([^()]*\))*[^()]*)\/([^()]*(?:\([^()]*\))*[^()]*)\)/g, "(($1) // ($2))");
  e = e.replace(/Math\.floor\(([^()]+)\)/g, "(($1) // 1)");
  e = e.replace(/([A-Za-z_$][\w$]*)\.length\b/g, "len($1)");
  e = e.replace(/===/g, "==").replace(/!==/g, "!=").replace(/&&/g, " and ").replace(/\|\|/g, " or ");
  e = e.replace(/!(?!=)/g, " not ");
  e = e.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
  if (/[^\w\s$()[\],+\-*/%<>=!.]/.test(e.replace(/\b(and|or|not|len)\b/g, ""))) throw new Error(`Line ${line}: could not read "${raw.trim()}".`);
  return e.replace(/\s+/g, " ").trim();
}

type Token = { text: string; line: number; end: ";" | "{" | "}" | "eof" };

function tokenize(source: string): Token[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  const out: Token[] = [];
  let buf = "";
  let line = 1;
  let start = 1;
  let depth = 0;
  for (const ch of clean) {
    if (ch === "\n") { line += 1; if (!buf.trim()) start = line; buf += " "; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if ((ch === ";" && depth === 0) || ch === "{" || ch === "}") {
      out.push({ text: buf.trim(), line: start, end: ch });
      buf = "";
      start = line;
      continue;
    }
    if (!buf.trim()) start = line;
    buf += ch;
  }
  if (buf.trim()) out.push({ text: buf.trim(), line: start, end: "eof" });
  return out;
}

export function jsToPython(source: string): Translated {
  const tokens = tokenize(source);
  const out: string[] = [];
  const map: number[] = [];
  const emit = (depth: number, text: string, line: number) => { out.push(`${"    ".repeat(depth)}${text}`); map.push(line); };
  // Stack of open blocks: closing a "for" block appends its step; "elif" chains close as one.
  const stack: { kind: "fn" | "block" | "for"; step?: string; line: number }[] = [];
  let pendingElse = false;
  for (const tok of tokens) {
    const depth = stack.length;
    const t = tok.text;
    if (tok.end === "{") {
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)$/))) { if (depth) throw new Error(`Line ${tok.line}: functions go at the top level.`); emit(depth, `def ${m[1]}(${m[2].split(",").map((p) => p.trim()).filter(Boolean).join(", ")}):`, tok.line); stack.push({ kind: "fn", line: tok.line }); }
      else if ((m = t.match(/^while\s*\((.+)\)$/))) { emit(depth, `while ${expr(m[1], tok.line)}:`, tok.line); stack.push({ kind: "block", line: tok.line }); }
      else if ((m = t.match(/^for\s*\(\s*(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);([^;]+);\s*([A-Za-z_$][\w$]*)\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)$/))) {
        emit(depth, `${m[1]} = ${expr(m[2], tok.line)}`, tok.line);
        emit(depth, `while ${expr(m[3], tok.line)}:`, tok.line);
        const step = m[5] === "++" ? `${m[4]} = ${m[4]} + 1` : m[5] === "--" ? `${m[4]} = ${m[4]} - 1` : `${m[4]} = ${m[4]} ${m[5][0]} ${m[5].slice(2).trim()}`;
        stack.push({ kind: "for", step, line: tok.line });
      }
      else if ((m = t.match(/^(?:else\s+)?if\s*\((.+)\)$/))) {
        const isElif = t.startsWith("else") || pendingElse;
        emit(depth, `${isElif ? "elif" : "if"} ${expr(m[1], tok.line)}:`, tok.line);
        stack.push({ kind: "block", line: tok.line });
      }
      else if (t === "else" || pendingElse) { emit(depth, "else:", tok.line); stack.push({ kind: "block", line: tok.line }); }
      else throw new Error(`Line ${tok.line}: could not read "${t}".`);
      pendingElse = false;
      continue;
    }
    if (t) {
      let m: RegExpMatchArray | null;
      if (t === "else") { pendingElse = true; continue; }
      if (!depth) throw new Error(`Line ${tok.line}: code outside a function is not traced. Put it in a function.`);
      if ((m = t.match(/^return(?:\s+(.+))?$/))) emit(depth, `return ${m[1] ? expr(m[1], tok.line) : "0"}`, tok.line);
      else if ((m = t.match(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/))) emit(depth, `${m[1]} = ${expr(m[2], tok.line)}`, tok.line);
      else if ((m = t.match(/^([A-Za-z_$][\w$]*)\s*(\+\+|--)$/))) emit(depth, `${m[1]} = ${m[1]} ${m[2] === "++" ? "+" : "-"} 1`, tok.line);
      else if ((m = t.match(/^([A-Za-z_$][\w$]*)\s*([+\-*])=\s*(.+)$/))) emit(depth, `${m[1]} = ${m[1]} ${m[2]} (${expr(m[3], tok.line)})`, tok.line);
      else if ((m = t.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/))) emit(depth, `${m[1]} = ${expr(m[2], tok.line)}`, tok.line);
      else emit(depth, expr(t, tok.line), tok.line);
    }
    if (tok.end === "}") {
      const closed = stack.pop();
      if (!closed) throw new Error(`Line ${tok.line}: an extra }.`);
      if (closed.kind === "for" && closed.step) emit(stack.length + 1, closed.step, closed.line);
    }
  }
  if (stack.length) throw new Error("A { is not closed.");
  // "else" written on the line after "}" is attached to the previous if by the next "{".
  return { python: out.join("\n"), lineMap: map };
}
