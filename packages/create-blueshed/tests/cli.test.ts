import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const parent = mkdtempSync(join(tmpdir(), "create-blueshed-"));
afterAll(() => rmSync(parent, { recursive: true, force: true }));
const cli = join(import.meta.dir, "../cli.ts");
const packages = join(import.meta.dir, "../..");

test("--local takes railroad, delta and dzql from this checkout, held by overrides", async () => {
  const made = Bun.spawnSync([process.execPath, cli, "app", "--local", "--no-install", "--no-git"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.exitCode).toBe(0);
  const pkg = await Bun.file(join(parent, "app/package.json")).json();
  for (const [name, dir] of [["@blueshed/railroad", "railroad"], ["@blueshed/delta", "delta"], ["dzql", "dzql"]]) {
    expect(pkg.overrides[name]).toBe(`file:${join(packages, dir)}`);
    expect(pkg.dependencies[name]).toBe(`file:${join(packages, dir)}`);
  }
  expect(existsSync(join(parent, "app/node_modules"))).toBe(false); // --no-install
});

test("without --local the app's packages are npm's, and a name already there is refused", () => {
  const made = Bun.spawnSync([process.execPath, cli, "plain", "--no-install", "--no-git"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.exitCode).toBe(0);
  const pkg = require(join(parent, "plain/package.json"));
  expect(pkg.overrides).toBeUndefined();
  expect(pkg.dependencies["@blueshed/delta"]).toStartWith("^");
  const again = Bun.spawnSync([process.execPath, cli, "plain", "--no-install"], { cwd: parent, stderr: "pipe" });
  expect(again.exitCode).toBe(1);
  expect(again.stderr.toString()).toContain('"plain" already exists');
});
