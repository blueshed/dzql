// bun run modeller <example> [--against <model.json>]
//
// An example's documents first (documents.ts): who holds what, who is told, and what permit lets
// through -- from a run of its stories when it has an app, from the stories alone when not. Then
// hjeli's predicates that still read something real from the stories, and the checks only
// stories can ask. `--against` runs hjeli over its own model of the same domain, for the comparison.

import type { Stories } from "../src/stories";
import { toEngineModel } from "./model/document-first";
import { runAll } from "./model/predicates";
import { compare, format, judge } from "./report";
import { documentsOf, format as formatDocuments } from "./documents";

const [name = "chat", ...rest] = process.argv.slice(2);
const i = rest.indexOf("--against");
const { stories } = (await import(`../examples/${name}/stories.ts`)) as { stories: Stories };
console.log(formatDocuments(name, await documentsOf(name)));
console.log();
const { reading, report } = judge(stories);
let against;
if (i >= 0) {
  const other = toEngineModel(await Bun.file(rest[i + 1]!).json());
  against = compare(reading, other, runAll(other));
}
console.log(format(name, report, against));
