// hjeli's three that `dzql model` lacked, each over the model's file (`model.sqlite`, as the page
// keeps it): `dzql model site` (the model read back for a customer, ../../examples/modeling/site.ts),
// `dzql model guards` (the guarded write layer, ../modelling/guards.ts: written only once the six
// registers are closed) and `dzql model mcp` (every model verb as a tool, over stdio, ./mcp.ts).
// Apart from ./model.ts, which `dzql model export` keeps.
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { modelIn } from "./model";

/** The model in its file, with its name, as the page keeps it (`mdl_models`), else the file's. */
export function rawIn(file: string) {
  const model = modelIn(file);
  const db = new Database(file, { readonly: true });
  let name = basename(file).replace(/\.sqlite$/, "");
  try {
    name = (db.query("SELECT name FROM mdl_models WHERE id = 1").get() as { name?: string } | null)?.name ?? name;
  } catch {
    // a model kept before its name was: the file's
  } finally {
    db.close();
  }
  return { models: { name }, ...model } as never;
}

/** Where to write: `--out <file>`, else stdout. */
function emit(rest: string[], text: string) {
  const out = rest.indexOf("--out");
  if (out >= 0 && rest[out + 1]) {
    writeFileSync(rest[out + 1]!, text);
    process.stderr.write(`wrote ${rest[out + 1]}\n`);
  } else process.stdout.write(text);
}
const fileOf = (rest: string[]) => rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--out") ?? "model.sqlite";

/** Runs `dzql model site|guards|mcp`; false for any other command. */
export async function run(argv: string[]): Promise<boolean> {
  const [verb, sub, ...rest] = argv;
  if (verb !== "model" || !["site", "guards", "mcp"].includes(sub ?? "")) return false;
  if (sub === "mcp") {
    const { runMcp } = await import("./mcp");
    await runMcp();
    process.exit(0);
  }
  const file = fileOf(rest);
  const raw = rawIn(file);
  if (sub === "site") {
    const { siteOf } = await import("../../examples/modeling/site");
    emit(rest, siteOf(raw));
    process.exit(0);
  }
  // guards: the checks first, then the generation -- never guards over a model with a register open
  const { closureOf, plainClosure } = await import("../../examples/modeling/closure");
  const registers = closureOf(raw);
  if (registers.some((r) => r.gaps.length > 0)) {
    process.stderr.write(`Not generated: close the six registers first.\n\n${plainClosure(registers)}\n`);
    process.exit(1);
  }
  const { guardsOf, guardSource } = await import("../modelling/guards");
  const guards = guardsOf(raw);
  if (guards.rules.length === 0) {
    process.stderr.write("Not generated: no story says what it writes (`writes <story> add <entity> ...`).\n");
    process.exit(1);
  }
  emit(rest, guardSource(guards, basename(file)));
  process.exit(0);
}
