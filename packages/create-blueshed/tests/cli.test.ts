import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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

test("without --local the app's packages are npm's, what a new app never gets is not copied, and a name already there is refused", () => {
  const made = Bun.spawnSync([process.execPath, cli, "plain", "--no-install", "--no-git"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.exitCode).toBe(0);
  const pkg = require(join(parent, "plain/package.json"));
  expect(pkg.overrides).toBeUndefined();
  expect(pkg.dependencies["@blueshed/delta"]).toStartWith("^");
  for (const never of ["logo.png", "evals", "node_modules"]) expect(existsSync(join(parent, "plain", never))).toBe(false); // UNCOPIED: never copied
  expect(existsSync(join(parent, "plain/create/setup.ts"))).toBe(true); // DELETED by setup, which needs it first
  const again = Bun.spawnSync([process.execPath, cli, "plain", "--no-install"], { cwd: parent, stderr: "pipe" });
  expect(again.exitCode).toBe(1);
  expect(again.stderr.toString()).toContain('"plain" already exists');
});

// The front door: an app as bun create makes one, its packages the workspace's own (the root's
// node_modules, linked in, as create-dzql's test does), then paintbrush's setup
test("bun create blueshed gives an app that says what it offers, with the model's page and its skill", async () => {
  const made = Bun.spawnSync([process.execPath, cli, "door", "--no-install", "--no-git"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.exitCode).toBe(0);
  const app = join(parent, "door");
  symlinkSync(join(packages, "../node_modules"), join(app, "node_modules"));
  const set = Bun.spawnSync([process.execPath, "create/setup.ts"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  expect(set.exitCode).toBe(0);

  expect(await Bun.file(join(app, "README.md")).text()).toContain("**You write your stories, a schema and documents. You get a live page, and proof that every\nstory holds");
  for (const skill of ["evolve", "modelling", "railroad", "delta-doc"]) expect(existsSync(join(app, ".claude/skills", skill, "SKILL.md"))).toBe(true);
  for (const skill of ["dzql-app", "bun-route"]) expect(existsSync(join(app, ".claude/skills", skill))).toBe(false);

  const proc = Bun.spawn(["bun", "run", "model"], { cwd: app, stdout: "pipe", stderr: "inherit", env: { ...process.env, MODEL_PORT: "0" } });
  try {
    let out = "";
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/Listening on \S+/.test(out)) break;
    }
    expect((await fetch(out.match(/Listening on (\S+)/)![1]!)).status).toBe(200);
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 60_000);

test("no git, or already inside a repository: the app is made, with no repository of its own, and it says why", () => {
  // inside a repository (as an app made in a monorepo is)
  const repo = join(parent, "mono");
  Bun.spawnSync(["mkdir", "-p", repo]);
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  const inside = Bun.spawnSync([process.execPath, cli, "inner", "--no-install"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  expect(inside.exitCode).toBe(0);
  expect(inside.stdout.toString()).toContain("already inside a git repository: no repository of its own");
  expect(existsSync(join(repo, "inner/.git"))).toBe(false);
  // no git on the PATH: Bun's spawnSync throws on a missing program, so the starter asks first
  const bare = Bun.spawnSync([process.execPath, cli, "bare", "--no-install"], { cwd: parent, stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: "/nonexistent" } });
  expect(bare.stderr.toString()).toBe("");
  expect(bare.exitCode).toBe(0);
  expect(bare.stdout.toString()).toContain("git not found: no repository made");
  expect(existsSync(join(parent, "bare/.git"))).toBe(false);
});

