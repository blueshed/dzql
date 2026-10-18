// `dzql serve` and `dzql model`: the two commands that are not Postgres's (src/postgres/cli.ts has
// those). Each runs what is already there: the page the server draws for an app's folder
// (src/rendering/start.ts), and the model's page, an app of its own (examples/modeling).
//
// The model is one file, `model.json` (delta's JSON file: its stories, with what each writes, and
// the documents they need), which the page edits and a person can read. `dzql model` serves the
// page and, after every change to the file, runs the checks; while none is open it makes the app's
// `types.ts`, `stories.ts`, `model.test.ts` and its next migration (`--out`, default `app`).
// `dzql model check` does that once, and exits 1 while a check is open.
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { nextMigrationOf, storiesOf, testsOf, typesOf, type Model } from "../modelling/definitions";

/** An app's folder as `ETA_EXAMPLE` names it: a path, from here. */
const folder = (dir = "./src") => (dir.includes("/") ? dir : `./${dir}`);

/** The model in its file: its name, stories and documents, as the page's `model:1` holds them. */
export function modelIn(file: string): Model & { name: string } {
  if (!existsSync(file)) throw new Error(`No model in ${file}: start the model's page with \`dzql model\`, and tell it the stories.`);
  const { tables } = JSON.parse(readFileSync(file, "utf8")) as { tables: Record<string, Record<string, unknown>[]> };
  return {
    name: String(tables.models?.[0]?.name ?? basename(file)),
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
  const dir = join(out, "migrations");
  mkdirSync(dir, { recursive: true });
  const { fromFolder } = await import("@blueshed/delta/sqlite");
  const next = nextMigrationOf(await fromFolder(resolve(dir)), model);
  writeFileSync(join(out, "types.ts"), typesOf(model));
  writeFileSync(join(out, "stories.ts"), storiesOf(model));
  writeFileSync(join(out, "model.test.ts"), testsOf(model, basename(resolve(out))));
  if (next) writeFileSync(join(dir, `${next.name}.ts`), next.source);
  const steps = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  return { ok: true, said: `${checks}\n\n${out}: types.ts, stories.ts, model.test.ts; migrations ${steps.map((f) => f.replace(/\.ts$/, "")).join(", ") || "none"}${next ? ` (${next.name} new)` : ""}` };
}

/** Runs `dzql serve` or `dzql model`; false for any other command. */
export async function run(argv: string[]): Promise<boolean> {
  const [verb, sub, ...rest] = argv;
  if (verb === "serve") {
    process.env.ETA_EXAMPLE = folder(sub);
    await import("../rendering/start");
    return true;
  }
  if (verb !== "model") return false;
  const port = process.env.MODEL_PORT ?? "3001";
  const flag = (name: string, or: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] ?? or : or);
  const file = process.env.MODEL_FILE ?? "model.json";
  if (sub === "check") {
    const { ok, said } = await make(file, flag("--out", "app"));
    process.stdout.write(`${said}\n`);
    process.exit(ok ? 0 : 1);
  }
  process.env.ETA_EXAMPLE = "modeling";
  if (!sub || sub.startsWith("--")) {
    const out = flag("--out", "app");
    process.env.PORT = port;
    process.env.MODEL_FILE = file;
    process.env.DB_PATH ??= ":memory:"; // sessions only: the model is the file
    // a project's own model, empty, named for the project -- not the example's seeded one
    process.env.MODEL_NAME ??= (() => {
      try {
        return String(JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).name);
      } catch {
        return basename(process.cwd());
      }
    })();
    await import("../rendering/start");
    // after every change to the model's file, by the page or by hand: the checks, and what they let it make
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => console.log((await make(file, out)).said), 200);
    };
    watch(resolve(file), again);
    again();
    return true;
  }
  process.env.ETA_URL ??= `ws://localhost:${port}`;
  process.argv = [process.argv[0]!, process.argv[1]!, sub, ...rest];
  await import("../rendering/cli");
  return true;
}
