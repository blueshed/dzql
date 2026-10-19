// Runs one example's stories (`examples/<name>/stories.ts`) against it and prints the report.
// `bun run stories` (chat, by default) or `ETA_EXAMPLE=wedding bun run stories`, or an app's own
// folder (`ETA_EXAMPLE=./src`, src/names.ts `appDir`). See docs/stories.md.
// Stories come first, so an example may have them before it has an app: that is said, as the next
// thing to do, not as a missing module.
import type { Stories } from "./stories";
import { appDir, appIn, storiesIn } from "../rendering/names";
import { print, run } from "./harness";

// a run's writes are thrown away: it never touches the app's own database, unless DB_PATH says one
// (the app opens it as it loads, below; the harness opens nothing until it runs)
process.env.DB_PATH ??= ":memory:";

const dir = appDir(process.env.ETA_EXAMPLE);
const at = dir.slice(process.cwd().length + 1) || dir;

if (!(await Bun.file(storiesIn(dir)).exists())) {
  console.log(`${at} has no stories.ts: an app starts with its stories (docs/stories.md).`);
  process.exit(1);
}
const { stories } = (await import(storiesIn(dir))) as { stories: Stories };
const example = await appIn(dir);
if (!example) {
  console.log(`${at} has ${stories.stories.length} stories and no app yet (no routes.ts): build the least that makes the first one pass -- the dzql-app skill says how.`);
  process.exit(1);
}

// STORY_BY_HAND=1 does by hand too, in a browser the size of a phone (src/by-hand.ts), each write a
// page sends and each refusal a control of it sends; a story that says its gesture, whenever it is told.
// STORY_WIRE=1 says under each story what it handed each page, and as it crossed the wire.
const report = await run(example, stories, undefined, { byHand: !!process.env.STORY_BY_HAND });
print(report, { wire: !!process.env.STORY_WIRE });
process.exit(report.failed > 0 ? 1 : 0);
