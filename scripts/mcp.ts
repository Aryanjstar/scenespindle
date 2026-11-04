/**
 * Minimal MCP server (stdio, JSON-RPC 2.0, newline-delimited) so AI IDEs can drive the
 * studio. Each tool is a thin wrapper over `studio remote`, which calls the same HTTP API
 * the web UI uses: nothing here bypasses validation, ownership or allowances.
 *
 * Register in an IDE, for example:
 *   { "command": "npx", "args": ["tsx", "scripts/mcp.ts"], "env": { "STUDIO_URL": "...", "STUDIO_TOKEN": "..." } }
 */
import { createInterface } from "node:readline";
import { HELP, remote } from "./remote";

type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; toArgs: (input: Record<string, unknown>) => string[] };

const s = (description: string) => ({ type: "string", description });
const flag = (name: string, value: unknown) => (value === undefined || value === null || value === "" ? [] : value === true ? [`--${name}`] : [`--${name}`, String(value)]);

const TOOLS: Tool[] = [
  { name: "studio", description: `Run any studio command. Same commands as the CLI:\n${HELP}`, inputSchema: { type: "object", properties: { args: { type: "array", items: { type: "string" }, description: 'For example ["create","--mode","story","--topic","A paper boat"]' } }, required: ["args"] }, toArgs: (input) => (input.args as string[]) ?? [] },
  { name: "list_projects", description: "List your projects.", inputSchema: { type: "object", properties: {} }, toArgs: () => ["projects"] },
  { name: "create_project", description: "Create a project.", inputSchema: { type: "object", properties: { mode: s("explainer, code_lab, audio, story, cartoon, lyrics or montage"), topic: s("What the film is about"), title: s("Optional title") }, required: ["mode", "topic"] }, toArgs: (i) => ["create", ...flag("mode", i.mode), ...flag("topic", i.topic), ...flag("title", i.title)] },
  { name: "get_storyboard", description: "Get the current draft storyboard and revision.", inputSchema: { type: "object", properties: { projectId: s("Project id") }, required: ["projectId"] }, toArgs: (i) => ["storyboard", String(i.projectId)] },
  { name: "plan_storyboard", description: "Plan the storyboard from the idea and approved brief.", inputSchema: { type: "object", properties: { projectId: s("Project id") }, required: ["projectId"] }, toArgs: (i) => ["plan", String(i.projectId)] },
  { name: "revise", description: "Ask the copilot for a change; optionally limit it to scenes and keep it.", inputSchema: { type: "object", properties: { projectId: s("Project id"), request: s("The change"), scenes: s("Comma-separated scene ids, e.g. s2,s3"), keep: { type: "boolean" } }, required: ["projectId", "request"] }, toArgs: (i) => ["copilot", String(i.projectId), String(i.request), ...flag("scenes", i.scenes), ...flag("keep", i.keep === true ? true : undefined)] },
  { name: "render_film", description: "Approve the storyboard and render the film; waits for the result.", inputSchema: { type: "object", properties: { projectId: s("Project id"), output: s("mp4 or preview") }, required: ["projectId"] }, toArgs: (i) => ["approve", String(i.projectId), ...flag("output", i.output ?? "mp4"), "--wait"] },
  { name: "list_videos", description: "List a project's film versions with QA results and file links.", inputSchema: { type: "object", properties: { projectId: s("Project id") }, required: ["projectId"] }, toArgs: (i) => ["videos", String(i.projectId)] },
  { name: "share_video", description: "Make or update a share link for a finished film.", inputSchema: { type: "object", properties: { videoId: s("Video id"), allowDownload: { type: "boolean" } }, required: ["videoId"] }, toArgs: (i) => ["share", String(i.videoId), ...flag("allow-download", i.allowDownload === true ? true : undefined)] },
];

function reply(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function fail(id: unknown, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } };
  try { message = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  const { id, method, params } = message;
  if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "scenespindle", version: "0.3.0" } });
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === "tools/call") {
    const tool = TOOLS.find((item) => item.name === params?.name);
    if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
    try {
      const result = await remote(tool.toArgs(params?.arguments ?? {}));
      return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2).slice(0, 100_000) }] });
    } catch (error) {
      return reply(id, { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The command failed." }] });
    }
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
});
