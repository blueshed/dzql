// bun run model:check <example | path> [--against-page [<model.json>]]
//
// An example's documents first (documents.ts): who holds what, who is told, and what permit lets
// through -- from a run of its stories when it has an app, from the stories alone when not. Then
// hjeli's predicates that still read something real from the stories, and the checks only
// stories can ask.
// `--against-page` is the model as told against the app as built, and nothing else (./told.ts): the
// model page read as the CLI signed in to it (.eta-session, or `--session <file>`; ETA_URL, by
// default ws://localhost:3005), or the page's document saved to a file.

import { extractSessionFile, savedServer } from "dzql/rendering/cli/commands";
import type { Stories } from "dzql/modelling/stories";
import { storiesIn } from "dzql/rendering/names";
import { format, judge } from "./report";
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
  // a saved page, or the model's own file (`dzql model`'s model.json, delta's: read as it stands)
  const saved = file && !file.startsWith("--") ? await Bun.file(file).json() : undefined;
  const page = saved ? (saved.tables ? (await import("../../../cli/model")).rawIn(file!) : saved) : await readPage(process.env.ETA_URL ?? savedServer(sessionFile) ?? "ws://localhost:3005", session).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
  const [t, b] = [told(page), built(writesOf((await extract(at)).heart))];
  console.log(formatGaps(name, gaps(t, b), matched(t, b)));
  process.exit(0);
}

const { stories } = (await import(storiesIn(dir))) as { stories: Stories };
console.log(formatDocuments(name, await documentsOf(at)));
console.log();
console.log(format(name, judge(stories).report));
