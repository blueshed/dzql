// `dzql serve` and `dzql model`: the two commands that are not Postgres's (src/postgres/cli.ts has
// those). Each runs what is already there: the page the server draws for an app's folder
// (src/rendering/start.ts), and the model's page, an app of its own (examples/modeling).
//
// The model is one file, `model.json` (delta's JSON file: its stories, with what each writes, and
// the documents they need), which the page edits and a person can read. `dzql model` serves the
// page and, after every change to the file, runs the checks; while none is open it makes, in a folder
// of its own (`--out`, default `model`, never the app's `src/`), `types.ts` (the app imports its
// definitions and extends its tables), `guards.ts` (stood in front of the store), the migrations and
// `model.test.ts` (the proof). The app's stories are the app's: each says its model story's number.
// `dzql model site|guards|mcp` are ./model-tools.ts's.
// `dzql model check` does that once, and exits 1 while a check is open.
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { nextMigrationOf, testsOf, typesOf, type Model } from "../modelling/definitions";

/** An app's folder as `ETA_EXAMPLE` names it: a path, from here. */
const folder = (dir = "./src") => (dir.includes("/") ? dir : `./${dir}`);

/** The model in its file: its name, stories and documents, as the page's `model:1` holds them. */
export function modelIn(file: string): Model & { name: string } {
  if (!existsSync(file)) throw new Error(`No model in ${file}: start the model's page with \`dzql model\`, and tell it the stories.`);
  const { tables } = JSON.parse(readFileSync(file, "utf8")) as { tables: Record<string, Record<string, unknown>[]> };
  return {
    name: String(tables.models?.[0]?.name ?? basename(file, ".json")),
    stories: (tables.stories ?? []) as unknown as Model["stories"],
    documents: (tables.documents ?? []) as unknown as Model["documents"],
  };
}

/**
 * The checks over the model in `file`, then, while none is open, what it makes in `out`: the
 * snapshot (types.ts), the tests (stories.ts, model.test.ts) and, when the schema says more than
 * the migrations there, the next one -- so the migrations are the model's trajectory, each step a
 * model the checks passed, and never behind it (model.test.ts folds them and compares). Nothing is
 * written while a check is open. Returns what to print, and whether every check passed.
 */
export async function make(file: string, out: string): Promise<{ ok: boolean; said: string }> {
  const { closureOf, plainClosure } = await import("../../examples/modeling/closure");
  const model = modelIn(file);
  const registers = closureOf({ models: { name: model.name }, ...model } as Parameters<typeof closureOf>[0]);
  const checks = plainClosure(registers);
  if (registers.some((r) => r.gaps.length > 0)) return { ok: false, said: `${checks}\n\nNothing made: close each gap first.` };
  if (Object.keys(model.stories ?? {}).length === 0) return { ok: true, said: "No stories yet: nothing made." };
  // what the model makes, written over only what it made before: a file a person wrote is kept,
  // and the model's goes beside it (`stories.model.ts`), for them to bring together
  const made: string[] = [];
  const put = (name: string, source: string) => {
    const at = join(out, name);
    const theirs = existsSync(at) && !/dzql model/.test(readFileSync(at, "utf8").split("\n", 1)[0]!);
    const as = theirs ? name.replace(/\.ts$/, ".model.ts") : name;
    writeFileSync(join(out, as), source);
    made.push(as);
  };
  const dir = join(out, "migrations");
  mkdirSync(dir, { recursive: true });
  const { fromFolder } = await import("@blueshed/delta/sqlite");
  const history = await fromFolder(resolve(dir));
  // a step only a person can finish (a parent changed, a type) is written once, for them to finish: not again on every change
  const last = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort().at(-1);
  const proposed = nextMigrationOf(history, model);
  const owed = proposed?.source.split("\n").filter((l) => l.startsWith("// By hand:")) ?? [];
  const next = proposed && last && !/^\s+\w+\(/m.test(proposed.source) && owed.every((l) => readFileSync(join(dir, last), "utf8").includes(l)) ? undefined : proposed;
  put("types.ts", typesOf(model));
  put("model.test.ts", testsOf(model, basename(resolve(out))));
  if (next) writeFileSync(join(dir, `${next.name}.ts`), next.source);
  // hjeli's guarded write layer, once a story says what it writes (./model-tools.ts, ../modelling/guards.ts)
  const { guardsOf, guardSource } = await import("../modelling/guards");
  const guards = guardsOf({ models: { name: model.name }, ...model } as Parameters<typeof guardsOf>[0]);
  if (guards.rules.length) put("guards.ts", guardSource(guards, basename(file)));
  const steps = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  return { ok: true, said: `${checks}\n\n${out}: ${made.join(", ")}; migrations ${steps.map((f) => f.replace(/\.ts$/, "")).join(", ") || "none"}${next ? ` (${next.name} new)` : ""}` };
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
  const { signInLinks } = await import("../../examples/modeling/signin");
  console.log(["The model's page, signed in by a link:", ...signInLinks(`http://localhost:${port}`).map((l) => `  ${l}`)].join("\n"));
}

/** After every change to the model's file, by the page or by hand: the checks, and what they let it make. */
function watchModel(file: string, out: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => console.log((await make(file, out)).said), 200);
  };
  watch(resolve(file), again);
  again();
}

/** Runs `dzql serve` or `dzql model`; false for any other command. */
export async function run(argv: string[]): Promise<boolean> {
  const [verb, sub, ...rest] = argv;
  const flag = (name: string, or: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] ?? or : or);
  const file = process.env.MODEL_FILE ?? "model.json";
  if (verb === "serve") {
    // the app's routes and resources; in development the model's beside them, at /model, writing
    // what it makes into its own folder (`model/`) -- production never registers it
    const dir = folder(sub);
    process.env.ETA_EXAMPLE = dir;
    const { run: running, serve } = await import("@blueshed/delta/serve");
    const { appDir } = await import("../rendering/names");
    const { appOf, compose } = await import("../rendering/server");
    const { example } = await import(`${appDir(dir)}/index.ts`);
    const dev = process.env.NODE_ENV !== "production";
    if (dev) {
      process.env.MODEL_FILE = file;
      process.env.MODEL_NAME ??= projectName();
    }
    const model = dev && (await import("../../examples/modeling/index.ts")).example;
    await running(() => serve(compose(appOf(example), model && appOf(model))));
    if (dev) {
      await sayLinks(process.env.PORT ?? "3000");
      watchModel(file, "model");
    }
    return true;
  }
  if (verb !== "model") return false;
  const port = process.env.MODEL_PORT ?? "3001";
  if (sub === "check") {
    const { ok, said } = await make(file, flag("--out", "model"));
    process.stdout.write(`${said}\n`);
    process.exit(ok ? 0 : 1);
  }
  process.env.ETA_EXAMPLE = "modeling";
  if (!sub || sub.startsWith("--")) {
    const out = flag("--out", "model");
    process.env.PORT = port;
    process.env.MODEL_FILE = file;
    process.env.DB_PATH ??= ":memory:"; // sessions only: the model is the file
    process.env.MODEL_NAME ??= projectName();
    await import("../rendering/start");
    await sayLinks(port);
    watchModel(file, out);
    return true;
  }
  process.env.ETA_URL ??= `ws://localhost:${port}/model`;
  process.argv = [process.argv[0]!, process.argv[1]!, sub, ...rest];
  await import("../rendering/cli");
  return true;
}
