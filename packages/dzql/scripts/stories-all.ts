#!/usr/bin/env bun
// Every example's stories, each in a browser by hand too (`bun run stories:all`).
import { EXAMPLES } from "./examples";

for (const example of EXAMPLES) {
  const proc = Bun.spawn(["bun", "run", "stories"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, STORY_BY_HAND: "1", ETA_EXAMPLE: example }, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}
