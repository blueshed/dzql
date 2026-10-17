// `dzql serve` and `dzql model`: the two commands that are not Postgres's (src/postgres/cli.ts has
// those). Each runs what is already there: the page the server draws for an app's folder
// (src/rendering/start.ts), and the model's page, an app of its own (examples/modeling).
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sourceOf, type Model } from "../modelling/definitions";

/** An app's folder as `ETA_EXAMPLE` names it: a path, from here. */
const folder = (dir = "./src") => (dir.includes("/") ? dir : `./${dir}`);

/** The model the page keeps in its file: its stories and documents, as `model:1` holds them. */
export function modelIn(file: string): Model {
  if (!existsSync(file)) throw new Error(`No model in ${file}: start the model's page with \`dzql model\`, and tell it the stories.`);
  const db = new Database(file, { readonly: true });
  try {
    const parse = (row: Record<string, unknown>, keys: string[]) => ({ ...row, ...Object.fromEntries(keys.map((k) => [k, JSON.parse(String(row[k] ?? "null"))])) });
    return {
      stories: (db.query("SELECT id, text, actor, kind FROM mdl_stories WHERE models_id = 1").all() as Record<string, unknown>[]) as Model["stories"],
      documents: (db.query("SELECT id, name, root, own, holds, held_by, stories FROM mdl_documents WHERE models_id = 1").all() as Record<string, unknown>[]).map((d) =>
        parse(d, ["holds", "held_by", "stories"]),
      ) as Model["documents"],
    };
  } finally {
    db.close();
  }
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
  if (sub === "export") {
    const out = rest.indexOf("--out");
    const file = rest.find((a, i) => !a.startsWith("--") && i !== out + 1) ?? "model.sqlite";
    const source = sourceOf(modelIn(file));
    if (out >= 0 && rest[out + 1]) writeFileSync(rest[out + 1]!, source);
    else process.stdout.write(source);
    process.exit(0);
  }
  process.env.ETA_EXAMPLE = "modeling";
  if (!sub) {
    process.env.PORT = port;
    process.env.DB_PATH = process.env.MODEL_DB ?? "model.sqlite"; // never the app's own database
    // a project's own model, empty, named for the project -- not the example's seeded one
    process.env.MODEL_NAME ??= (() => {
      try {
        return String(JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).name);
      } catch {
        return basename(process.cwd());
      }
    })();
    await import("../rendering/start");
    return true;
  }
  process.env.ETA_URL ??= `ws://localhost:${port}`;
  process.argv = [process.argv[0]!, process.argv[1]!, sub, ...rest];
  await import("../rendering/cli");
  return true;
}
