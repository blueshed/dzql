import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { make } from "../cli/model";

// The tools agree. Each part of the path from a model to an app reads the model: the checks
// (examples/modeling/closure.ts), the proof (./definitions.ts, `testsOf`), the guards (./guards.ts)
// and the read-back. Each was once fixed alone, after a model the checks called closed failed its
// proof, or a guard refused what the checks called decided (cafe-e's feedback). So, for every model
// here: the checks close; then `dzql model` makes it; then the proof it made passes -- each story's
// write lands where its tellers see it, made through the guards as its teller, and each `cannot` is
// refused with its own words. A model that breaks one of these is a fixture to add.

// leave's model; cafe-e's, as a blank Claude told it; a menu, a list (`menu:`); and the worked
// example's, the cafe built from its model (examples/cafe/model.json)
const FIXTURES: Record<string, string> = {
  leave: `${import.meta.dir}/fixtures/leave.json`,
  "cafe-e": `${import.meta.dir}/fixtures/cafe-e.json`,
  menu: `${import.meta.dir}/fixtures/menu.json`,
  cafe: `${import.meta.dir}/../../examples/cafe/model.json`,
};

describe("closed implies proved implies guarded", () => {
  for (const [name, file] of Object.entries(FIXTURES))
    test(name, async () => {
      const dir = mkdtempSync(join(import.meta.dir, ".conformance-"));
      try {
        copyFileSync(file, join(dir, "model.json"));
        const { ok, said } = await make(join(dir, "model.json"), join(dir, "model"));
        expect(said).not.toContain("gap");
        expect(ok).toBe(true);
        expect(existsSync(join(dir, "model", "guards.ts"))).toBe(true);
        const run = Bun.spawnSync(["bun", "test", "model/model.test.ts"], { cwd: dir, env: { ...process.env, LOG_LEVEL: "silent" } });
        const out = run.stderr.toString();
        expect(out).toContain(" 0 fail");
        expect(readFileSync(join(dir, "model", "model.test.ts"), "utf8")).toContain("guardWrites(local.server, guards"); // the proof holds the guards, not the store alone
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
});

// And the read-back: the worked example, the cafe built from its model, is its model as told -- every
// story matched, every document as the model says it (examples/modeling/loader/told.ts).
test("the read-back: the cafe built from its model is the model as told", async () => {
  const { extract } = await import("../../examples/modeling/loader/extract");
  const { writesOf } = await import("../../examples/modeling/loader/writes");
  const { built, gaps, told } = await import("../../examples/modeling/loader/told");
  const { tables } = (await Bun.file(FIXTURES.cafe!).json()) as { tables: { stories: { id: number }[]; documents: { id: number }[] } };
  const byId = <T extends { id: number }>(rows: T[]) => Object.fromEntries(rows.map((r) => [String(r.id), r]));
  const page = { models: { name: "cafe" }, stories: byId(tables.stories), documents: byId(tables.documents) };
  expect(gaps(told(page as never), built(writesOf((await extract("cafe")).heart)))).toEqual([]);
}, 60_000);
