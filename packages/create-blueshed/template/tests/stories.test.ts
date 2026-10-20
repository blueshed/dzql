import { expect, test } from "bun:test";
import { untold } from "dzql/modelling/stories";
import { stories } from "../stories";

// Every story in stories.ts is told by a test named from it (`stories.<key>.name`).
test("every story is told by a test named from it", async () => {
  const files = [...new Bun.Glob("*.test.ts").scanSync(import.meta.dir)].filter((f) => f !== "stories.test.ts");
  const sources = await Promise.all(files.map((f) => Bun.file(`${import.meta.dir}/${f}`).text()));
  expect(untold(stories, sources)).toEqual([]);
});
