import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// dzql's examples, said once: every folder of examples/ with stories (examples/delta holds delta's
// Postgres examples, which have none). The test runs, the stories and the fast tier all read it.
const at = join(import.meta.dir, "..", "examples");
export const EXAMPLES = readdirSync(at).filter((name) => existsSync(join(at, name, "stories.ts"))).sort();
/** The model's page: an app of dzql's own, with its stories, shipped in src/ (`dzql model` serves it). */
export const PAGE = join(import.meta.dir, "..", "src", "modelling", "page");
