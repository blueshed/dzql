// bun modeller/closure.ts <example> [--against <model.json>]
//
// hjeli's six predicates over an example's stories, and the checks only stories can ask.
// `--against` runs hjeli over its own model of the same domain, for the comparison.

import type { Stories } from "../src/stories";
import { toEngineModel } from "./model/document-first";
import { runAll } from "./model/predicates";
import { compare, format, judge } from "./report";

const [name = "chat", ...rest] = process.argv.slice(2);
const i = rest.indexOf("--against");
const { stories } = (await import(`../examples/${name}/stories.ts`)) as { stories: Stories };
const { reading, report } = judge(stories);
let against;
if (i >= 0) {
  const other = toEngineModel(await Bun.file(rest[i + 1]!).json());
  against = compare(reading, other, runAll(other));
}
console.log(format(name, report, against));
