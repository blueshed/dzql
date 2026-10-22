// `dzql model`: the command that is not Postgres's (src/postgres/cli.ts has those). It runs what is
// already there: the model's page, an app of its own (src/modelling/page).
//
// The model is one file, `model.json` (delta's JSON file: its stories, with what each writes, and
// the documents they need), which the page edits and a person can read. `dzql model` serves the
// page and, after every change to the file, runs the checks; while none is open it makes, in a folder
// of its own (`--out`, default `model`, never the app's `src/`), `types.ts` (the app imports its
// definitions and extends its tables), `guards.ts` (stood in front of the store), the migrations and
// `model.test.ts` (the proof). The app's stories are the app's: each says its model story's number.
// `dzql model site|guards|mcp` are ./model-tools.ts's.
// `dzql model check` does that once, and exits 1 while a check is open.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Change } from "@blueshed/delta/migrations";
import { stateOf } from "@blueshed/delta/migrations";
import { nextMigrationOf, testsOf, typesOf, type Model } from "../modelling/definitions";
import { extractSessionFile, savedServer } from "../rendering/cli/commands";


/** The model in its file: its name, stories and documents, as the page's `model:1` holds them. */
/** The model in its file, with its name, as the page keeps it (`{ models: { name } }`): what the checks and the guards read. */
export function rawIn(file: string) {
  const { name, ...model } = modelIn(file);
  return { models: { name }, ...model } as never;
}

export function modelIn(file: string): Model & { name: string } {
  if (!existsSync(file)) throw new Error(`No model in ${file}: start the model's page with \`dzql model\`, and tell it the stories.`);
  const { tables } = JSON.parse(readFileSync(file, "utf8")) as { tables: Record<string, Record<string, unknown>[]> };
  // delta's file keeps every version of a row; the model is the rows as they stand (no valid_to)
  const now = (key: string) => (tables[key] ?? []).filter((row) => row.valid_to == null).map(({ valid_from: _f, valid_to: _t, ...row }) => row);
  return {
    name: String(now("models")[0]?.name ?? basename(file, ".json")),
    stories: now("stories") as unknown as Model["stories"],
    documents: now("documents") as unknown as Model["documents"],
  };
}

/**
 * The checks over the model in `file`, then, while none is open, what it makes in `out`: the
 * snapshot (types.ts), the guards (guards.ts), the proof (model.test.ts, through the guards) and, when the
 * schema says more than the migrations there, the next one -- or the newest again, while it is not yet
 * committed -- so the migrations are the model's trajectory, each committed step a model the checks
 * passed, and never behind it (model.test.ts folds them and compares). Nothing is
 * written while a check is open. Returns what to print, and whether every check passed.
 */
export async function make(file: string, out: string, options: { drops?: boolean } = {}): Promise<{ ok: boolean; said: string }> {
  try {
    return await making(file, out, options);
  } catch (err) {
    // never quietly stale: what failed, and that what is there is behind the page
    return { ok: false, said: `Nothing made: making ${out}/ failed: ${(err as Error).message}\n${out}/ is as it was, behind the model.` };
  }
}

async function making(file: string, out: string, { drops = false }: { drops?: boolean }): Promise<{ ok: boolean; said: string }> {
  const { closureOf, plainClosure } = await import("../modelling/page/closure");
  const model = modelIn(file);
  const registers = closureOf(rawIn(file));
  const checks = plainClosure(registers);
  if (registers.some((r) => r.gaps.length > 0)) return { ok: false, said: `${checks}\n\nNothing made: close each gap first.` };
  if (Object.keys(model.stories ?? {}).length === 0) return { ok: true, said: "No stories yet: nothing made." };
  const dir = join(out, "migrations");
  mkdirSync(dir, { recursive: true });
  const steps = () => readdirSync(dir).filter((f) => f.endsWith(".ts") && !/\.(d|test)\.ts$/.test(f)).sort();
  // while modelling, the newest step not yet committed is rewritten in place, not followed by another
  // (cafe-e: six steps in one afternoon, each undoing some of the last); once committed it is history
  const newest = steps().at(-1);
  const open = newest && !committed(join(dir, newest)) ? newest : undefined;
  const kept = steps().filter((f) => f !== open);
  const history = await Promise.all(kept.map((f) => stepIn(join(dir, f))));
  // a step only a person can finish (a parent changed, a type) is written once, for them to finish:
  // a By hand: line an earlier step already carries is owed there, not again
  const before = kept.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const proposed = nextMigrationOf(history, model, (line) => before.includes(line));
  // a step that drops a column or a table loses data: the page never writes one on its own (an undo,
  // a field list said again, might be a slip); `dzql model check` writes it, said so
  const dropped = proposed?.source.match(/\b(dropColumn|dropTable)\([^)]*\)/g) ?? [];
  const held = dropped.length > 0 && !drops;
  const next = held ? undefined : proposed;
  // what the model makes, written over only what it made before: a file a person wrote is kept,
  // and the model's goes beside it (`types.model.ts`); a file already as it would be is left alone,
  // so a server under `bun --hot` that imports it does not reload for nothing
  const made: string[] = [];
  const put = (name: string, source: (as: string) => string) => {
    const at = join(out, name);
    const theirs = existsSync(at) && !/dzql model/.test(readFileSync(at, "utf8").split("\n", 1)[0]!);
    const as = theirs ? name.replace(/\.ts$/, ".model.ts") : name;
    const text = source(as);
    if (!existsSync(join(out, as)) || readFileSync(join(out, as), "utf8") !== text) writeFileSync(join(out, as), text);
    made.push(as);
    return as;
  };
  // a table the committed steps made keeps what they made it (an app from before every table kept its history)
  const types = put("types.ts", () => typesOf(model, undefined, stateOf(history)));
  // hjeli's guarded write layer, once a story says what it writes (./model-tools.ts, ../modelling/guards.ts); the proof makes its writes through it
  const { guardsOf, guardSource } = await import("../modelling/guards");
  const guards = guardsOf(rawIn(file));
  const guarded = guards.rules.length ? put("guards.ts", () => guardSource(guards, basename(file))) : undefined;
  put("model.test.ts", () => testsOf(model, basename(resolve(out)), `./${types.replace(/\.ts$/, "")}`, guarded && `./${guarded.replace(/\.ts$/, "")}`));
  // the open step, as the model now says it: rewritten, or gone when the model is back at the committed steps
  if (open && (next || !proposed)) rmSync(join(dir, open));
  if (next) writeFileSync(join(dir, `${next.name}.ts`), next.source);
  const waiting = held ? `\nA step that drops data is waiting, not written: ${dropped.join(", ")}. If that is meant, \`dzql model check --drops\` writes it; if not, say the model again.` : "";
  return { ok: true, said: `${checks}\n\nmodel: ${made.join(", ")}; migrations ${steps().map((f) => f.replace(/\.ts$/, "")).join(", ") || "none"}${next ? ` (${next.name} ${open ? "rewritten: not yet committed" : "new"})` : open && !proposed ? ` (${open.replace(/\.ts$/, "")} gone: the model is back at the committed steps)` : ""}${waiting}` };
}

/**
 * Is a step committed: in git, as git has it at HEAD? Outside a repository every step is its own,
 * as before there was this rule.
 */
function committed(file: string): boolean {
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dirname(file), stdout: "ignore", stderr: "ignore" }).exitCode;
  if (git("rev-parse", "--is-inside-work-tree") !== 0) return true;
  return git("ls-files", "--error-unmatch", basename(file)) === 0 && git("diff", "--quiet", "HEAD", "--", basename(file)) === 0;
}

/** A step as it is now: one rewritten in place is read again, not from the import cache. */
async function stepIn(file: string): Promise<{ id: string; changes?: Change[] }> {
  const mod = await import(`${resolve(file)}?v=${statSync(file).mtimeMs}`);
  return { id: basename(file, ".ts"), ...(Array.isArray(mod.changes) && { changes: mod.changes }) };
}

/** A project's own model is named for the project -- not the example's seeded one. */
function projectName(): string {
  try {
    return String(JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).name);
  } catch {
    return basename(process.cwd());
  }
}

/** Each keeper of the model's link to sign in, where the server starts: no email, no password. */
async function sayLinks(port: string): Promise<void> {
  const { links } = await import("../modelling/page/signin");
  console.log(["The model's page, signed in by a link:", ...links.say(`http://localhost:${port}`).map((l) => `  ${l}`)].join("\n"));
}

/**
 * After every change to the model's file, by the page or by hand: the checks, and what they let it
 * make. One watcher a process: `bun --hot` running this again closes the last one, so a change is
 * made once, not once for every reload.
 */
function watchModel(file: string, out: string): void {
  const kept = globalThis as { __dzqlModelWatch?: { close(): void } };
  kept.__dzqlModelWatch?.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => console.log((await make(file, out)).said), 200);
  };
  const watcher = watch(resolve(file), again);
  kept.__dzqlModelWatch = { close: () => (clearTimeout(timer), watcher.close()) };
  again();
}

/**
 * The model as a route, for an app's routes in development: `compose(app, await modelRoute())`.
 * Its page at /model, the model in `model.json`, what the checks let it make in `model/`; a
 * sign-in link printed for each keeper. Production never calls it, so never registers it.
 */
export async function modelRoute({ file = process.env.MODEL_FILE ?? "model.json", out = "model", port = process.env.PORT ?? "3000" } = {}) {
  process.env.MODEL_FILE = file;
  process.env.MODEL_NAME ??= projectName();
  const { appOf } = await import("../rendering/server");
  const app = await appOf((await import("../modelling/page/routes")).app);
  await sayLinks(String(port));
  watchModel(file, out);
  return app;
}

/** What `dzql model --help` says: the command and its verbs, as the modelling skill's reference.md has them. */
export const USAGE = `Usage: dzql model [<verb>]

  (no verb) [--out model]        start the model's page (MODEL_PORT, 3001), the model in model.json (MODEL_FILE)
  check [--out model] [--drops]  every check once; makes model/ while none is open, else exits 1
  show                           the model read back: its stories, documents and checks
  login <link>                   sign the CLI in, with the link the page printed for it
  story <actor> <does|cannot> <words>     reword <n> <words>     teller <n> <actor>     unsay <n>
  touches <n> <entity>...        writes <n> add <entity> replace <entity>.<field>=<value> remove <entity>...
  requires <n> <entity>.<field>=<value>...
  document <name> <root> <story>...       holds <doc> <entity> [under <parent>] <field[:type]>...
  heldby <doc> <actor>...        own <doc>     list <doc>     serves <doc> <story>...
  rename <doc> <name>            drop <doc>    unhold <doc> <entity>     root <doc> <entity>
  undo, redo
  site, guards, mcp              the model as a site, its guards, its verbs over MCP
  load [<app>]                   an app that exists loaded into the page (<app>: its folder, ./src)
  built [<app>] [--against-page [<model.json>]]   the app as built, read back; against the model as told

The app's own: \`dzql stories [<app>]\` (its stories told against it), \`dzql cli <command>\` (its CLI).

Stop a page started here with \`delta stop\` (\`bun run stop\` in a project).
`;

/** Runs `dzql model`; false for any other command. */
export async function run(argv: string[]): Promise<boolean> {
  const [verb, sub, ...rest] = argv;
  const flag = (name: string, or: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] ?? or : or);
  const file = process.env.MODEL_FILE ?? "model.json";
  if (verb !== "model") return false;
  // asked how, it says so and stops: never the page, which would not exit (an evaluation's feedback)
  if ([sub, ...rest].some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const port = process.env.MODEL_PORT ?? "3001";
  if (sub === "check") {
    if (!existsSync(file)) {
      process.stderr.write(`No model in ${file}: start the model's page with \`dzql model\`, and tell it the stories.\n`);
      process.exit(1);
    }
    const { ok, said } = await make(file, flag("--out", "model"), { drops: rest.includes("--drops") });
    process.stdout.write(`${said}\n`);
    process.exit(ok ? 0 : 1);
  }
  if (sub === "show") {
    // a read, the page's own: the kernel's CLI finds it only as its first word, and here it is the second
    const { sessionFile } = extractSessionFile(rest);
    const { show } = await import("../modelling/page/cli");
    process.exit(await show(process.env.ETA_URL ?? savedServer(sessionFile) ?? `ws://localhost:${port}/model`, sessionFile));
  }
  process.env.ETA_EXAMPLE = `${import.meta.dir}/../modelling/page`;
  if (!sub || sub.startsWith("--")) {
    const out = flag("--out", "model");
    process.env.PORT = port;
    process.env.MODEL_FILE = file;
    process.env.DB_PATH ??= ":memory:"; // sessions only: the model is the file
    process.env.MODEL_NAME ??= projectName();
    const { run } = await import("@blueshed/delta/serve");
    const { startServer } = await import("../modelling/page/routes");
    await run(() => startServer({ port: Number(port) }));
    await sayLinks(port);
    watchModel(file, out);
    return true;
  }
  // the server the CLI signed in to (its link said where), else the model's own on its port
  if (!savedServer(extractSessionFile(rest).sessionFile)) process.env.ETA_URL ??= `ws://localhost:${port}/model`;
  await (await import("../rendering/cli")).main([sub, ...rest]);
  return true;
}
