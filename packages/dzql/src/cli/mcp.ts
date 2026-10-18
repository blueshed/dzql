// `dzql model mcp`: the model's verbs as MCP tools, over stdio, as hjeli's `hjeli mcp` had them, so
// any MCP host (Claude Desktop, Zed, Cursor, VS Code) keeps a model the way the modelling skill does
// from the CLI. JSON-RPC 2.0, a message a line, by hand (no SDK). Each tool runs `dzql` itself, in
// a process of its own, and answers with what it printed: the protocol's stdout stays clean, and a
// tool does exactly what the command does. The verbs that write go to the model's page as the CLI's
// do (`MODEL_PORT`, the session in `.eta-session`); check, site and guards read the file.
import pkg from "../../package.json";

type Json = any;
/** Runs `dzql` with these arguments: what it printed, and how it exited. */
export type Runner = (argv: string[]) => Promise<{ text: string; code: number }>;

const PROTOCOL_VERSION = "2024-11-05";
const file = { type: "string", description: "The model's file, as `dzql model` keeps it (default model.json)." };
const out = { type: "string", description: "Write to this file instead of answering with it." };
const story = { type: "string", description: "The story's number, as `show` lists it." };
const doc = { type: "string", description: "The document's number, as `show` lists it." };
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });

type Tool = { name: string; description: string; inputSchema: Json; argv: (a: Json) => string[]; softFail?: true };
const tool = (name: string, description: string, properties: Json, required: string[], argv: (a: Json) => string[], softFail?: true): Tool => ({
  name: `model_${name}`,
  description,
  inputSchema: { type: "object", properties, required },
  argv,
  ...(softFail && { softFail }),
});
const fileArgs = (a: Json) => [...(a.file ? [a.file] : []), ...(a.out ? ["--out", a.out] : [])];

/** The verbs, as tools. */
export const tools: Tool[] = [
  tool("check", "The checks over the model (hjeli's six, Easy's coverage, playability); while none is open, types.ts, guards.ts, migrations and model.test.ts are made in `out` (default model). Gaps are an answer, not an error.", { out: { type: "string", description: "The folder the model's files go in (default model)." } }, [], (a) => ["model", "check", ...(a.out ? ["--out", a.out] : [])], true),
  tool("show", "The model as its page shows it, in plain text, with the six registers.", {}, [], () => ["model", "show"]),
  tool("story", "Tell a story: who tells it, whether they do it or cannot, its words; `post` when it posts a form to a route.", { actor: { type: "string" }, kind: { type: "string", enum: ["does", "cannot"] }, text: { type: "string" }, post: { type: "string" } }, ["actor", "kind", "text"], (a) => ["model", "story", a.actor, a.kind, ...(a.post ? ["--post", a.post] : []), a.text]),
  tool("reword", "Say a story in new words.", { story, text: { type: "string" } }, ["story", "text"], (a) => ["model", "reword", a.story, a.text]),
  tool("touches", "The entities a story touches.", { story, entities: strings("Entity names.") }, ["story", "entities"], (a) => ["model", "touches", a.story, ...a.entities]),
  tool("writes", "What a story writes: each `add <entity>`, `replace <entity>.<field>=<value>` or `remove <entity>`.", { story, writes: strings('Each as said, e.g. "replace requests.status=approved".') }, ["story", "writes"], (a) => ["model", "writes", a.story, ...a.writes.flatMap((w: string) => w.trim().split(/\s+/))]),
  tool("requires", "The states a story presupposes, each `<entity>.<field>=<value>`.", { story, states: strings('e.g. "requests.status=waiting".') }, ["story", "states"], (a) => ["model", "requires", a.story, ...a.states]),
  tool("unsay", "Take a story back.", { story }, ["story"], (a) => ["model", "unsay", a.story]),
  tool("document", "Describe a document: its name, its root, the stories it serves.", { name: { type: "string" }, root: { type: "string" }, stories: strings("Story numbers.") }, ["name", "root"], (a) => ["model", "document", a.name, a.root, ...(a.stories ?? [])]),
  tool("own", "Make a document each person's own (a session), not shared.", { document: doc }, ["document"], (a) => ["model", "own", a.document]),
  tool("list", "Make a document list every row of its root (`menu:`, the whole menu), not one of them (`menu:1`).", { document: doc }, ["document"], (a) => ["model", "list", a.document]),
  tool("holds", "What a document holds: an entity, what it hangs under, its fields (`name` or `name:type`).", { document: doc, entity: { type: "string" }, under: { type: "string" }, fields: strings('e.g. "starts:date", "status".') }, ["document", "entity"], (a) => ["model", "holds", a.document, a.entity, ...(a.under ? ["under", a.under] : []), ...(a.fields ?? [])]),
  tool("unhold", "Take an entity out of a document.", { document: doc, entity: { type: "string" } }, ["document", "entity"], (a) => ["model", "unhold", a.document, a.entity]),
  tool("heldby", "Who holds a document.", { document: doc, people: strings("Actors, as the stories name them.") }, ["document", "people"], (a) => ["model", "heldby", a.document, ...a.people]),
  tool("serves", "The stories a document serves.", { document: doc, stories: strings("Story numbers.") }, ["document", "stories"], (a) => ["model", "serves", a.document, ...a.stories]),
  tool("rename", "Rename a document.", { document: doc, name: { type: "string" } }, ["document", "name"], (a) => ["model", "rename", a.document, a.name]),
  tool("drop", "Take a document out.", { document: doc }, ["document"], (a) => ["model", "drop", a.document]),
  tool("undo", "Undo the last change to the model.", {}, [], () => ["model", "undo"]),
  tool("redo", "Redo what was undone.", {}, [], () => ["model", "redo"]),
  tool("site", "The model read back for a customer: one static HTML page, a chapter per person.", { file, out }, [], (a) => ["model", "site", ...fileArgs(a)]),
  tool("guards", "The guarded write layer: every write the stories say, with what it presupposes. Refused while a register is open.", { file, out }, [], (a) => ["model", "guards", ...fileArgs(a)]),
];

/** `dzql`, in a process of its own, from where the server was started. */
export const spawnDzql: Runner = async (argv) => {
  const p = Bun.spawn(["bun", `${import.meta.dir}/index.ts`, ...argv], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { text: stdout + stderr, code };
};

const ok = (id: Json, result: Json) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Json, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** The JSON-RPC answer to a request, or null for a notification. */
export function mcpHandler(run: Runner = spawnDzql, version: string = pkg.version) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return async function handle(req: Json): Promise<Json | null> {
    const { id, method, params } = req ?? {};
    if (method === "initialize") return ok(id, { protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "dzql-model", version } });
    if (method === "tools/list") return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === "ping") return ok(id, {});
    if (method === "tools/call") {
      const t = byName.get(params?.name);
      if (!t) return fail(id, -32602, `unknown tool: ${params?.name}`);
      const args = params?.arguments ?? {};
      const missing = (t.inputSchema.required as string[]).filter((k) => args[k] === undefined);
      if (missing.length) return fail(id, -32602, `${t.name} needs ${missing.join(", ")}`);
      const { text, code } = await run(t.argv(args));
      return ok(id, { content: [{ type: "text", text: text || (code === 0 ? "(ok)" : "(no output)") }], isError: !t.softFail && code !== 0 });
    }
    if (id === undefined) return null; // a notification: notifications/initialized
    return fail(id, -32601, `method not found: ${method}`);
  };
}

/** Serve over stdin and stdout until stdin closes. */
export async function runMcp(handle = mcpHandler()): Promise<void> {
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let req: Json;
      try {
        req = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify(fail(null, -32700, "parse error"))}\n`);
        continue;
      }
      const res = await handle(req);
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    }
  }
}
