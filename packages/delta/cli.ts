#!/usr/bin/env bun
/** @blueshed/delta CLI: the commands are listed in `USAGE`. */
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";

const USAGE =
    `Usage:\n` +
    `  delta install-skills [--user] [--dry-run] [--skip <name,...>]   copy the packages' skills in, but those named\n` +
    `  delta stop                             stop the server run() started here (.server.pid, or $PID_FILE)\n` +
    `  delta migrate <database> [--app <name>] [--dir <migrations>] [--status]   run (or list) an app's migrations\n` +
    `        <database>: a SQLite file; --dir defaults to ./migrations (Postgres: dzql migrate)\n` +
    `  delta migrations make <module> [--dir <migrations>] [--name <name>] [--export <name>]\n` +
    `        the next migration: what the module's schema says beyond the migrations in --dir\n` +
    `  delta link <database> <person> [--origin <url>] [--opens <path>]   a link to sign in as someone\n` +
    `        (auth-link): the first person's, on the server; <database> a SQLite file (Postgres: dzql link)\n` +
    `\n` +
    `  delta open  <docName>                  Open a doc, print its state, exit.\n` +
    `  delta watch <docName>                  Open a doc, then print each broadcast to it, a line each.\n` +
    `        [--count <n>] [--for <ms>] [--until "<op> <path>"]   exit 0 at the first that comes\n` +
    `  delta delta <docName> <opsJSON>        Apply JSON-Patch ops to a doc; print the ops as applied.\n` +
    `  delta call  <method>  [paramsJSON]     Invoke an RPC method.\n` +
    `\n` +
    `Runtime commands take:\n` +
    `  --url <url>  |  DELTA_WS_URL  |  .delta file  |  ws://localhost:\${PORT:-3100}/ws   (in order)\n` +
    `  --token <t>  |  DELTA_TOKEN    sent as call authenticate first, never in the URL\n` +
    `  --timeout <ms>  for connecting and for each answer (default 10000; 0 waits for ever)\n` +
    `  --json       one JSON line per event on stdout; an error is one {"error":{"code","message"}}\n` +
    `               line on stderr: code is the server's, or 0 when the CLI met it itself\n` +
    `\n` +
    `Exit codes: 0 done, 1 an error (the server's, the connection's), 2 a bad argument.\n`;

// ---------------------------------------------------------------------------
// Runtime CLI — open / watch / delta / call against a running delta server.
//
// For a person: answers pretty-printed, status on stderr. With --json, for a
// program (an agent): one JSON line per event on stdout, nothing else; an
// error is one {"error":{code,message}} line on stderr -- the server's, or
// code 0 for one the CLI met itself -- exit 1, or 2 for a bad argument.
// ---------------------------------------------------------------------------

let json = process.argv.includes("--json");   // before parsing: a flag parseArgs refuses is answered in kind

const print = (result: unknown) => process.stdout.write(JSON.stringify(result ?? null, null, json ? undefined : 2) + "\n");
const say = (line: string) => { if (!json) process.stderr.write(line + "\n"); };

/** An error: the server's `{ code, message }` as it is, or one the CLI met itself, code 0. Exits `exit`. */
function fail(err: unknown, exit = 1): never {
  const told = !!err && typeof err === "object" && !(err instanceof Error);
  const error = told ? { code: 0, ...(err as object) } : { code: 0, message: err instanceof Error ? err.message : String(err) };
  process.stderr.write((json ? JSON.stringify({ error }) : `delta: ${told ? JSON.stringify(err) : error.message}`) + "\n");
  process.exit(exit);
}

/** A bad argument: exit 2; a person is shown the usage too, when `show`. */
function usageError(why: string, show = false): never {
  if (show && !json) process.stderr.write(USAGE + "\n");
  fail(why, 2);
}

function resolveWsUrl(values: Record<string, unknown>): string {
  const flag = values.url as string | undefined;
  if (flag) return flag;
  if (process.env.DELTA_WS_URL) return process.env.DELTA_WS_URL;
  try {
    const fromFile = readFileSync(resolve(process.cwd(), ".delta"), "utf8").trim();
    if (fromFile) return fromFile;
  } catch {}
  return `ws://localhost:${process.env.PORT ?? "3100"}/ws`;
}

interface Api {
  send: (msg: any) => Promise<any>;
  onBroadcast: (handler: (msg: any) => void) => void;
  /** Rejects when the server closes the socket. */
  closed: Promise<never>;
}

/**
 * Connect, sign in when there is a token (`--token` or DELTA_TOKEN, sent as
 * `call authenticate`, never in the URL), run `fn`, close.
 */
async function withWs<T>(values: Record<string, unknown>, fn: (api: Api) => Promise<T>): Promise<T> {
  const url = resolveWsUrl(values);
  const timeout = wholeNumber(values.timeout ?? "10000", "--timeout");
  /** `p`, or an error once it has gone --timeout ms unsettled (0: wait for ever). */
  const within = <V>(p: Promise<V>, what: string): Promise<V> => {
    if (!timeout) return p;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${timeout} ms: ${what}`)), timeout); });
    return Promise.race([p, late]).finally(() => clearTimeout(timer));
  };
  const ws = new WebSocket(url);
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  const broadcastHandlers = new Set<(msg: any) => void>();
  let nextId = 1;
  let onClosed!: (err: Error) => void;
  const closed = new Promise<never>((_, reject) => (onClosed = reject));
  closed.catch(() => {});   // asked only by watch

  await within(new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e: any) => reject(new Error(`WebSocket error: ${e?.message ?? "connection failed"}`));
  }), `connecting to ${url}`);

  ws.onmessage = (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch (err) {
      // A malformed frame shouldn't crash the command — warn and keep going.
      process.stderr.write(
        `delta: ignoring malformed frame: ${(err as Error).message}\n`,
      );
      return;
    }
    try {
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
        return;
      }
      // Unsolicited broadcast (no id).
      for (const h of broadcastHandlers) h(msg);
    } catch (err) {
      process.stderr.write(
        `delta: error handling frame: ${(err as Error).message}\n`,
      );
    }
  };

  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error("socket closed"));
    pending.clear();
    onClosed(new Error("socket closed"));
  };

  const api: Api = {
    send(msg: any): Promise<any> {
      const id = nextId++;
      return within(new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ ...msg, id }));
      }), msg.action === "call" ? `call ${msg.method}` : `${msg.action} ${msg.doc}`);
    },
    onBroadcast(handler: (msg: any) => void) { broadcastHandlers.add(handler); },
    closed,
  };

  try {
    const token = (values.token as string | undefined) ?? process.env.DELTA_TOKEN;
    if (token) await api.send({ action: "call", method: "authenticate", params: { token } });
    return await fn(api);
  } finally {
    ws.onclose = null;
    try { ws.close(); } catch {}
  }
}

function parseJsonArg(s: string | undefined, label: string): unknown {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); }
  catch (err) { usageError(`${label} is not valid JSON: ${(err as Error).message}`); }
}

async function cmdOpen(docName: string | undefined, values: Record<string, unknown>) {
  if (!docName) usageError("open takes a <docName>", true);
  print(await withWs(values, ({ send }) => send({ action: "open", doc: docName })));
}

function wholeNumber(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) usageError(`${flag} takes a whole number, not ${value}`);
  return n;
}

/** `--until "<op> <path>"` or `--until <path>`: an op at that path or under it, of that verb if given. */
function untilOf(value: unknown): ((op: any) => boolean) | undefined {
  if (value === undefined) return undefined;
  const s = String(value);
  const at = s.indexOf("/");
  const verb = at < 0 ? "" : s.slice(0, at).trim();
  const path = s.slice(at);
  if (at < 0 || (verb && !["add", "replace", "remove"].includes(verb))) {
    usageError(`--until takes "<op> <path>" or "<path>", e.g. "add /items", not ${s}`);
  }
  return (op) => (!verb || op?.op === verb) && (op?.path === path || String(op?.path).startsWith(path + "/"));
}

/**
 * Print the doc's state, then each broadcast to it, one JSON line each. Ends,
 * exit 0, when the first of --count broadcasts, --for ms or an op --until
 * names comes; without one, at Ctrl-C. An error told for the doc, or the
 * server closing the socket, ends it with exit 1.
 */
async function cmdWatch(docName: string | undefined, values: Record<string, unknown>) {
  if (!docName) usageError("watch takes a <docName>", true);
  const most = wholeNumber(values.count, "--count");
  const ms = wholeNumber(values.for, "--for");
  const until = untilOf(values.until);
  const line = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  const ends = most !== undefined || ms !== undefined || until !== undefined;
  say(`watching ${docName} on ${resolveWsUrl(values)}${ends ? "" : " (Ctrl-C to stop)"}`);
  // --for counts from now, before connecting: run out before the doc is open, and it is an error
  const end = Promise.withResolvers<void>();
  let opened = false;
  const timer = ms === undefined ? undefined
    : setTimeout(() => (opened ? end.resolve() : end.reject(new Error(`no answer in ${ms} ms (--for): open ${docName}`))), ms);
  const watching = withWs(values, async ({ send, onBroadcast, closed }) => {
    let heard = 0;
    const enough = () => { if (most !== undefined && heard >= most) end.resolve(); };
    onBroadcast((msg) => {
      if (msg.doc !== docName) return;
      if (msg.error) return end.reject(msg.error);
      line(msg);
      heard++;
      enough();
      if (until && Array.isArray(msg.ops) && msg.ops.some(until)) end.resolve();
    });
    const state = await send({ action: "open", doc: docName });
    opened = true;
    say(`opened ${docName}`);
    line({ doc: docName, state: state ?? null });
    enough();
    await Promise.race([end.promise, closed]);
  });
  try { await Promise.race([end.promise, watching]); }
  finally { clearTimeout(timer); }
}

async function cmdDelta(
  docName: string | undefined,
  opsJson: string | undefined,
  values: Record<string, unknown>,
) {
  if (!docName || !opsJson) usageError("delta takes a <docName> and <opsJSON>", true);
  const ops = parseJsonArg(opsJson, "ops");
  if (!Array.isArray(ops)) usageError("ops must be a JSON array");
  print(await withWs(values, async ({ send }) => {
    // SQLite's registerDocs requires the doc to be cached before delta;
    // opening on the same socket is the cheapest way to guarantee it.
    await send({ action: "open", doc: docName });
    // `inverse: true` asks for the ops as applied (and the inverse, where the backend keeps one)
    return send({ action: "delta", doc: docName, ops, inverse: true });
  }));
}

async function cmdCall(
  method: string | undefined,
  paramsJson: string | undefined,
  values: Record<string, unknown>,
) {
  if (!method) usageError("call takes a <method>", true);
  const params = parseJsonArg(paramsJson, "params");
  print(await withWs(values, ({ send }) => send({ action: "call", method, params: params ?? {} })));
}

// ---------------------------------------------------------------------------
// delta migrations make
// ---------------------------------------------------------------------------

/**
 * The next migration, written: what the module's schema (its `schema` export, or --export) says beyond
 * the migrations in --dir (./migrations), as `NNN-<name>.ts` -- changes, and as comments what a person
 * must write (a rename, a change of type). Nothing beyond them: nothing written.
 */
async function cmdMake(module: string | undefined, values: Record<string, unknown>) {
  if (!module) usageError("migrations make takes the <module> that exports the schema: delta migrations make src/db.ts", true);
  const path = resolve(process.cwd(), module);
  if (!existsSync(path)) usageError(`no module at ${module}`);
  const dir = resolve(process.cwd(), (values.dir as string | undefined) ?? "migrations");
  const name = ((values.name as string | undefined) ?? "changes").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "changes";
  const schema = (await import(path))[(values.export as string | undefined) ?? "schema"];
  if (!schema?.tables) usageError(`${module} exports no schema (${(values.export as string | undefined) ?? "schema"}): defineSchema(...)`);
  const { diff, stateOf, writeMigration } = await import("./src/server/changes");
  const { fromFolder } = await import("./src/server/migrate");
  const { mkdirSync, readdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const list = await fromFolder(dir);
  const { changes, byHand } = diff(stateOf(list), schema);
  if (changes.length === 0 && byHand.length === 0) {
    if (json) return print({ made: null });
    process.stdout.write("nothing to make: the migrations say what the definitions say\n");
    return;
  }
  const next = 1 + Math.max(0, ...readdirSync(dir).map((f) => Number(/^(\d+)-/.exec(f)?.[1] ?? 0)));
  const file = join(dir, `${String(next).padStart(3, "0")}-${name}.ts`);
  writeFileSync(file, writeMigration(changes, byHand, process.env.DELTA_MIGRATIONS_FROM ?? "@blueshed/delta/migrations"));
  if (json) return print({ made: file, changes: changes.length, byHand });
  process.stdout.write(`made ${file}: ${changes.length} change${changes.length === 1 ? "" : "s"}\n`);
  for (const b of byHand) process.stdout.write(`by hand: ${b}\n`);
}

// ---------------------------------------------------------------------------
// delta link
// ---------------------------------------------------------------------------

/**
 * A link to sign in as `person` (auth-link), made in the app's SQLite file: how the first person
 * signs in, before anyone can send them one. The site is --origin, else ORIGIN, else Railway's
 * domain. Postgres is dzql's (`dzql link`).
 */
async function cmdLink(target: string | undefined, person: string | undefined, values: Record<string, unknown>) {
  if (!target || !person) usageError("link takes a <database> and a <person>: delta link app.db 1", true);
  if (!/^\d+$/.test(person)) usageError(`<person> is a person's id, a number: ${person}`);
  const path = resolve(process.cwd(), target);
  if (/^postgres(ql)?:\/\//.test(target) || (existsSync(path) && statSync(path).isDirectory())) usageError(`${target} is Postgres: dzql link makes its links`);
  if (!existsSync(path)) usageError(`no database at ${target}`);
  const { Database } = await import("bun:sqlite");
  const { makeLink, siteOrigin, sqliteLinkStore } = await import("./src/server/auth-link");
  let origin: string;
  try { origin = (values.origin as string | undefined) ?? siteOrigin(); }
  catch (err) { usageError(`${(err as Error).message}, or pass --origin`); }
  const db = new Database(path);
  try {
    const made = await makeLink(sqliteLinkStore(db), Number(person), { origin, opens: values.opens as string | undefined });
    if (json) return print(made);
    process.stdout.write(`${made.url}\n(used once, until ${made.expires})\n`);
  } finally { db.close(); }
}

// ---------------------------------------------------------------------------
// delta migrate
// ---------------------------------------------------------------------------

/**
 * Run an app's migrations (`--dir`, default ./migrations, each `NNN-name.ts`
 * exporting `up`; `--app` names the app when apps share the database) against
 * its database, or with --status say which ran and which are pending. With no
 * schema to ask, an app with nothing recorded is new only to a database with
 * no table but delta's: the app's own start-up, given its schema, knows better.
 * The database: a SQLite file that is there (a name mistyped makes no new
 * database); Postgres is dzql's (`dzql migrate`).
 */
async function cmdMigrate(target: string | undefined, values: Record<string, unknown>) {
  if (!target) usageError("migrate takes a <database>: a SQLite file (Postgres: dzql migrate)", true);
  const { setLogLevel } = await import("./src/server/logger");
  setLogLevel(json ? "silent" : "warn");
  const dir = resolve(process.cwd(), (values.dir as string | undefined) ?? "migrations");
  const status = !!values.status;
  const options = { app: (values.app as string | undefined) ?? "" };
  const path = resolve(process.cwd(), target);
  if (/^postgres(ql)?:\/\//.test(target) || (existsSync(path) && statSync(path).isDirectory())) usageError(`${target} is Postgres: dzql migrate runs its migrations`);
  if (!existsSync(path)) usageError(`no database at ${target}`);
  if (!existsSync(dir)) usageError(`no migrations folder at ${dir} (--dir)`);

  let answer: unknown;
  const { Database } = await import("bun:sqlite");
  const sqlite = await import("./src/server/sqlite/migrate");
  const db = new Database(path);
  try {
    const list = await sqlite.fromFolder(dir);
    answer = status ? await sqlite.migrationStatus(db, list, options) : await sqlite.migrate(db, list, options);
  } finally { db.close(); }
  if (json) return print(answer);
  if (status) {
    const s = answer as import("./src/server/migrate").MigrationStatus;
    if (s.fresh) process.stdout.write("new database: migrate records every migration as run, and runs none\n");
    for (const r of s.ran) process.stdout.write(`ran      ${r.id}  ${r.ran_at}\n`);
    for (const id of s.pending) process.stdout.write(`pending  ${id}\n`);
    for (const id of s.unknown) process.stdout.write(`unknown  ${id}  (ran here, not in ${dir})\n`);
    return;
  }
  const r = answer as import("./src/server/migrate").MigrateResult;
  if (r.fresh) process.stdout.write("new database: every migration recorded as run, none run\n");
  for (const id of r.ran) process.stdout.write(`ran      ${id}\n`);
  if (!r.fresh && r.ran.length === 0) process.stdout.write("nothing to run\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let parsed;
  try { parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      user: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      url: { type: "string" },
      token: { type: "string" },
      json: { type: "boolean", default: false },
      count: { type: "string" },
      for: { type: "string" },
      until: { type: "string" },
      timeout: { type: "string" },
      dir: { type: "string" },
      app: { type: "string" },
      status: { type: "boolean", default: false },
      origin: { type: "string" },
      name: { type: "string" },
      export: { type: "string" },
      opens: { type: "string" },
      skip: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  }); }
  catch (err) { usageError((err as Error).message, true); }
  const { values, positionals } = parsed;

  if (values.help) { process.stdout.write(USAGE); return; }

  const cmd = positionals[0];
  const arg = positionals[1];
  const arg2 = positionals[2];

  switch (cmd) {
    case "install-skills":  return (await import("./src/cli/skills")).installSkills(values);
    case "stop":            return console.log(await (await import("./src/server/serve")).stop());
    case "open":            return cmdOpen(arg, values);
    case "watch":           return cmdWatch(arg, values);
    case "delta":           return cmdDelta(arg, arg2, values);
    case "call":            return cmdCall(arg, arg2, values);
    case "migrate":         return cmdMigrate(arg, values);
    case "link":            return cmdLink(arg, arg2, values);
    case "migrations":      return arg === "make" ? cmdMake(arg2, values) : usageError("migrations make <module>, please", true);
    default:                usageError(cmd ? `no command ${cmd}` : "a command, please", true);
  }
}

main().catch((err) => fail(err));
