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

const FIXTURES = ["leave", "cafe-e", "menu"]; // menu: a list, every row of its root (`menu:`)

describe("closed implies proved implies guarded", () => {
  for (const name of FIXTURES)
    test(name, async () => {
      const dir = mkdtempSync(join(import.meta.dir, ".conformance-"));
      try {
        copyFileSync(join(import.meta.dir, "fixtures", `${name}.json`), join(dir, "model.json"));
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
