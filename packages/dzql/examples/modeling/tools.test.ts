import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mcpHandler, tools, type Runner } from "../../src/cli/mcp";
import type { Raw } from "./heart";
import { requireSentence, siteOf, writeSentence } from "./site";

// hjeli's three that `dzql model` lacked: the site a customer reads, the model's verbs over MCP, and
// the guards written from the model (the guards themselves: src/modelling/guards.test.ts).
const field = (name: string, type = "text") => ({ name, type });
const leave: Raw = {
  models: { name: "leave" },
  stories: {
    "1": { id: 1, text: "Mo starts a team", actor: "mo", kind: "does", writes: [{ entity: "teams", op: "add" }] },
    "2": { id: 2, text: "Mo opens the team to requests", actor: "mo", kind: "does", writes: [{ entity: "teams", op: "replace", path: "open", to: "yes" }] },
    "3": { id: 3, text: "Ann asks for a week off", actor: "ann", kind: "does", writes: [{ entity: "requests", op: "add", path: "status", to: "waiting" }], requires: [{ entity: "teams", path: "open", value: "yes" }] },
    "4": { id: 4, text: "Mo approves a request that is waiting", actor: "mo", kind: "does", writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] },
    "5": { id: 5, text: "Ann cannot approve her own request", actor: "ann", kind: "cannot", writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }] },
    "6": { id: 6, text: "Ann takes back a request that's still waiting", actor: "ann", kind: "does", writes: [{ entity: "requests", op: "remove" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] },
    "7": { id: 7, text: "Ann cannot start a team", actor: "ann", kind: "cannot", writes: [{ entity: "teams", op: "add" }] },
    "8": { id: 8, text: "Ann cannot open the team", actor: "ann", kind: "cannot", writes: [{ entity: "teams", op: "replace", path: "open", to: "yes" }] },
    "9": { id: 9, text: "Mo cannot ask for leave", actor: "mo", kind: "cannot", writes: [{ entity: "requests", op: "add", path: "status", to: "waiting" }] },
    "10": { id: 10, text: "Mo cannot take back Ann's request", actor: "mo", kind: "cannot", writes: [{ entity: "requests", op: "remove" }] },
  },
  documents: {
    "1": { id: 1, name: "team", root: "teams", holds: { teams: { parent: null, fields: [field("name"), field("open")] }, requests: { parent: "teams", fields: [field("starts", "date"), field("status")] } }, held_by: ["ann", "mo"], stories: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  },
};

describe("dzql model site: the model read back for a customer", () => {
  const site = siteOf(leave, "2026-10-18");

  test("one static page: no scripts, the same page for the same model", () => {
    expect(site).toStartWith("<!doctype html>");
    expect(site).not.toContain("<script");
    expect(siteOf(leave, "2026-10-18")).toBe(site);
    expect(site).toContain("<title>Leave, in stories</title>");
    expect(site).toContain("10 stories, told by 2 people, and the 1 page they need. Every question the model is asked has its answer.");
  });

  test("a chapter a person: what they do, with each write and what it waits on, what they cannot, and what is in front of them", () => {
    expect(site).toContain('<section class="chapter" id="who-mo"><h2>Mo</h2>');
    expect(site).toContain("<span>Ann asks for a week off.</span><span class=\"rules\">Adds a request, its status “waiting”; only while the team’s open is “yes”.</span>");
    expect(site).toContain("<h3>What ann cannot do</h3>");
    expect(site).toContain('<li class="story cannot"><span>Ann cannot approve her own request.</span>');
    expect(site).toContain('<a class="chip" href="#doc-team">team</a>');
    expect(site).toContain('<article class="card" id="doc-team"><h4>Team</h4><p>One team, with its requests.</p>');
    expect(site.match(/id="doc-team"/g)).toHaveLength(1);
    expect(site).toContain('<li style="margin-left:28px"><b>requests</b> <span class="muted">starts, status</span></li>');
  });

  test("where it stands, in the customer's words, and the records as a tree and as mermaid", () => {
    expect(site).toContain('<li class="register closed"><b>Everything can happen</b>');
    expect(site).toContain("<li><b>requests</b> <span class=\"muted\">under teams</span>: starts, status</li>");
    expect(site).toContain("erDiagram\n  teams ||--o{ requests : has");
    expect(site).toContain("Made by <code>dzql model site</code> from the model of leave, 2026-10-18.");
  });

  test("a model with questions open says so, and what it has not been asked; each person's own is its own chapter", () => {
    const open = siteOf({ models: { name: "desk" }, stories: { "1": { id: 1, text: "Jo signs in", actor: "jo", kind: "does", touches: ["rotas"] } }, documents: { "1": { id: 1, name: "session", root: "sessions", own: 1, held_by: [], stories: [1] } } });
    expect(open).toContain("1 story, told by 1 person, and the 1 page they need. 2 questions are still open");
    expect(open).toContain("<li>no document holds rotas, so nobody is told when it changes</li>");
    expect(open).toContain("Not asked yet: the stories don’t say what they change.");
    expect(open).toContain("<h2>Everyone’s own</h2>");
    expect(open).toContain("<p>Your own session.</p>");
    expect(open).toContain("Nothing is in front of jo yet.");
    expect(open).toContain("erDiagram\n  sessions\n  rotas"); // a document that says nothing of what it holds holds its root
    expect(siteOf({ models: { name: "x" } })).toContain("0 stories, told by 0 people, and the 0 pages they need.");
    expect(siteOf({ models: { name: "x" }, documents: { "1": { id: 1, name: "d", root: "t", held_by: ["a"], stories: [] } } })).toContain("2 questions are still open");
  });

  test("each write and each requirement, as someone reads it", () => {
    expect(writeSentence({ entity: "people", op: "add" })).toBe("adds a person");
    expect(writeSentence({ entity: "orders", op: "add", path: "table_id" })).toBe("adds an order, its table said");
    expect(writeSentence({ entity: "orders", op: "remove" })).toBe("takes an order away");
    expect(writeSentence({ entity: "orders", op: "replace", path: "paid_on" })).toBe("sets an order’s paid on");
    expect(writeSentence({ entity: "orders", op: "replace" })).toBe("changes an order");
    expect(requireSentence({ entity: "orders", path: "status", value: "open" })).toBe("only while the order’s status is “open”");
  });
});

describe("dzql model mcp: the model's verbs as tools", () => {
  const ran: string[][] = [];
  const runner: Runner = async (argv) => (ran.push(argv), argv[1] === "check" ? { text: "Reachability: 1 gap\n", code: 1 } : argv[1] === "drop" ? { text: "", code: 1 } : { text: "", code: 0 });
  const handle = mcpHandler(runner, "9.9.9");
  const call = (name: string, args: Record<string, unknown>) => handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });

  test("it says who it is, and lists every verb with what it takes", async () => {
    expect(await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).toEqual({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "dzql-model", version: "9.9.9" } } });
    const listed = (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools;
    expect(listed.map((t: { name: string }) => t.name)).toEqual(tools.map((t) => t.name));
    expect(listed.map((t: { name: string }) => t.name)).toContain("model_guards");
    expect(listed.find((t: { name: string }) => t.name === "model_story").inputSchema.required).toEqual(["actor", "kind", "text"]);
    expect(await handle({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await handle({ jsonrpc: "2.0", id: 4, method: "resources/list" })).error).toEqual({ code: -32601, message: "method not found: resources/list" });
    expect(await handle(null)).toBeNull();
  });

  test("each tool is the CLI's command, said as the modelling skill says it", async () => {
    await call("model_story", { actor: "ann", kind: "does", text: "Ann's week off", post: "/ask" });
    await call("model_writes", { story: "3", writes: ["add requests.status=waiting", "replace  teams.open=yes"] });
    await call("model_holds", { document: "1", entity: "requests", under: "teams", fields: ["starts:date"] });
    await call("model_holds", { document: "1", entity: "teams" });
    await call("model_document", { name: "team", root: "teams" });
    await call("model_site", { file: "m.json", out: "site.html" });
    await call("model_show", {});
    expect(ran).toEqual([
      ["model", "story", "ann", "does", "--post", "/ask", "Ann's week off"],
      ["model", "writes", "3", "add", "requests.status=waiting", "replace", "teams.open=yes"],
      ["model", "holds", "1", "requests", "under", "teams", "starts:date"],
      ["model", "holds", "1", "teams"],
      ["model", "document", "team", "teams"],
      ["model", "site", "m.json", "--out", "site.html"],
      ["model", "show"],
    ]);
    for (const t of tools) expect(t.argv({ story: "1", document: "1", entities: [], writes: [], states: [], people: [], stories: [], text: "t", name: "n", actor: "a", kind: "does", root: "r", entity: "e" })[0]).toBe("model");
  });

  test("gaps are an answer and a failed command an error; a tool it lacks, or an argument missing, is refused", async () => {
    expect((await call("model_check", {})).result).toEqual({ content: [{ type: "text", text: "Reachability: 1 gap\n" }], isError: false });
    expect((await call("model_drop", { document: "1" })).result).toEqual({ content: [{ type: "text", text: "(no output)" }], isError: true });
    expect((await call("model_own", { document: "1" })).result.content[0].text).toBe("(ok)");
    expect((await call("model_nothing", {})).error).toEqual({ code: -32602, message: "unknown tool: model_nothing" });
    expect((await call("model_story", { actor: "ann" })).error).toEqual({ code: -32602, message: "model_story needs kind, text" });
    expect((await handle({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "model_show" } })).result.isError).toBe(false);
  });
});

describe("over a model's file, from the command line and over stdio", () => {
  const cli = `${import.meta.dir}/../../src/cli/index.ts`;
  // the model's file as the page keeps it: delta's JSON file, its rows by collection
  const saved = (file: string, name: string | undefined, stories: unknown[], documents: unknown[]) =>
    Bun.write(file, JSON.stringify({ tables: { ...(name ? { models: [{ id: 1, name }] } : {}), stories, documents } }));
  const made = async () => {
    const file = `${process.env.TMPDIR ?? "/tmp"}/tools-${crypto.randomUUID()}.json`;
    const stories = Object.values(leave.stories!).map((s) => ({ ...s, models_id: 1, post: null, touches: [], writes: s.writes ?? null, requires: s.requires ?? null }));
    await saved(file, "leave", stories, []);
    return { file, stories };
  };
  const run = async (args: string[], input?: string) => {
    const p = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe", stdin: input === undefined ? "ignore" : new Blob([input]) });
    return { out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text(), code: await p.exited };
  };

  test("guards are refused while a register is open, and written once all six are closed; the site either way", async () => {
    const { file, stories } = await made();
    const refused = await run(["model", "guards", file]);
    expect(refused.code).toBe(1);
    expect(refused.err).toStartWith("Not generated: close every check first.\n\nChecks (hjeli's six, Easy's coverage, derive-ux's playability)\nReachability: 12 gaps");
    await saved(file, "leave", stories, [{ ...leave.documents!["1"]!, models_id: 1, own: 0 }]);
    const written = await run(["model", "guards", file]);
    expect(written.code).toBe(0);
    expect(written.out).toContain('"text": "Mo approves a request that is waiting"');
    const site = await run(["model", "site", file, "--out", `${file}.html`]);
    expect(site.err).toBe(`wrote ${file}.html\n`);
    expect(await Bun.file(`${file}.html`).text()).toContain("<title>Leave, in stories</title>");
    // over stdio, as an MCP host speaks: a line a message, each answered on a line
    const lines = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "model_site", arguments: { file } } },
    ];
    const mcp = await run(["model", "mcp"], `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n\n`);
    const answers = mcp.out.trim().split("\n").map((l) => JSON.parse(l));
    expect(answers.map((a) => a.id)).toEqual([1, 2, null]);
    expect(answers[1].result.content[0].text).toContain("<title>Leave, in stories</title>");
    expect(answers[2].error).toEqual({ code: -32700, message: "parse error" });
    for (const f of [file, `${file}.html`]) await Bun.file(f).delete();
  }, 60000);

  test("a model with no write said has no guards to write; a model kept before its name, the file's name", async () => {
    const file = `${process.env.TMPDIR ?? "/tmp"}/plain-${crypto.randomUUID()}.json`;
    await saved(file, undefined, [{ id: 1, models_id: 1, text: "Ann reads the board", actor: "ann", kind: "does", post: null, touches: ["notes"] }], [{ id: 1, models_id: 1, name: "board", root: "notes", own: 0, holds: { notes: { parent: null, fields: [{ name: "text", type: "text" }] } }, held_by: ["ann"], stories: [1] }]);
    const none = await run(["model", "guards", file]);
    expect(none.code).toBe(1);
    expect(none.err).toBe("Not generated: no story says what it writes (`writes <story> add <entity> ...`).\n");
    const site = await run(["model", "site", file]);
    expect(site.out).toContain(`<title>${file.split("/").at(-1)!.replace(/\.json$/, "").replace(/^p/, "P")}, in stories</title>`);
    await Bun.file(file).delete();
  }, 30000);
});
