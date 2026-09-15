// Runs one example's stories (`examples/<name>/stories.ts`) against it and prints the report.
// `bun run stories` (chat, by default) or `ETA_EXAMPLE=wedding bun run stories`. See stories.md.
import { print, run } from "./harness";

const exampleName = process.env.ETA_EXAMPLE ?? "chat";
const { example } = await import(`${import.meta.dir}/../examples/${exampleName}/index.ts`);
const { stories } = await import(`${import.meta.dir}/../examples/${exampleName}/stories.ts`);

const report = await run(example, stories);
print(report);
process.exit(report.failed > 0 ? 1 : 0);
