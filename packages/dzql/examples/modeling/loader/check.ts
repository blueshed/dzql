// bun run model:check <example | path> [--against <model.json>] [--against-page [<model.json>]]
//
// An example's documents first (documents.ts): who holds what, who is told, and what permit lets
// through -- from a run of its stories when it has an app, from the stories alone when not. Then
// hjeli's predicates that still read something real from the stories, and the checks only
// stories can ask. `--against` runs hjeli over its own model of the same domain, for the comparison.
// `--against-page` is the model as told against the app as built, and nothing else (./told.ts): the
// model page read as the CLI signed in to it (.eta-session, or `--session <file>`; ETA_URL, by
// default ws://localhost:3005), or the page's document saved to a file.

import { extractSessionFile } from "dzql/rendering/cli/commands";
import type { Stories } from "dzql/modelling/stories";
import { toEngineModel } from "./model/document-first";
import { runAll } from "./model/predicates";
import { compare, format, judge } from "./report";
import { documentsOf, exampleAt, format as formatDocuments } from "./documents";
import { extract } from "./extract";
import { built, format as formatGaps, gaps, matched, readPage, told } from "./told";
import { writesOf } from "./writes";

const { sessionFile, rest: argv } = extractSessionFile(process.argv.slice(2));
const [at = "chat", ...rest] = argv;
const { dir, name } = exampleAt(at);

const p = rest.indexOf("--against-page");
if (p >= 0) {
  const file = rest[p + 1];
  const session = (await Bun.file(sessionFile).text().catch(() => "")).trim();
  const page = file && !file.startsWith("--") ? await Bun.file(file).json() : await readPage(process.env.ETA_URL ?? "ws://localhost:3005", session).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
  const [t, b] = [told(page), built(writesOf((await extract(at)).heart))];
  console.log(formatGaps(name, gaps(t, b), matched(t, b)));
  process.exit(0);
}

const i = rest.indexOf("--against");
const { stories } = (await import(`${dir}/stories.ts`)) as { stories: Stories };
console.log(formatDocuments(name, await documentsOf(at)));
console.log();
const { reading, report } = judge(stories);
let against;
if (i >= 0) {
  const other = toEngineModel(await Bun.file(rest[i + 1]!).json());
  against = compare(reading, other, runAll(other));
}
console.log(format(name, report, against));
