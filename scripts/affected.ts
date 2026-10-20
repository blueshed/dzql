#!/usr/bin/env bun
/**
 * `bun run affected`: the gate for what a change touches. The packages whose files changed (against
 * origin/main: commits not pushed, staged, unstaged, untracked), and every package that depends on
 * one of them, each run its fast tier: a type check and the tests that need no browser and no
 * Postgres server. `--slow` runs the slow tier too (the browser tests, dzql's Postgres suite in
 * Docker, dzql's stories and costs): CI runs it (`.github/workflows/ci.yml`), and it runs before a release.
 * `--all` runs every package. `--dry-run` says what would run. Whatever changed, it first holds the
 * docs to the code (scripts/docs.ts): every link and every path a README, CLAUDE.md, skill or doc names;
 * and the sibling ranges to the workspace's versions (scripts/ranges.ts).
 *
 * A package says its tiers in its package.json: `test:fast`, and `test:slow`; a package runs its whole
 * fast tier, never a part chosen by path (dzql's two halves import each other: a split by folder
 * missed both ways).
 *
 * A starter's template (its `template/`, a workspace of its own: the app a new one is copied from) is
 * part of its create package here: a file changed in it is the package's, its dependencies are the
 * package's (a change in dzql runs create-dzql), and the package's tiers run the template's.
 */
import { $ } from "bun";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const slow = args.has("--slow");
// `--base <commit>`: what changed since that commit (CI names the one before a push); else since this
// branch left origin/main
const given = args.has("--base") ? argv[argv.indexOf("--base") + 1] : undefined;

type Pkg = { dir: string; names: string[]; deps: string[]; scripts: Record<string, string> };
const depsOf = (json: Record<string, Record<string, string> | undefined>) => Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.peerDependencies });
const pkgs: Pkg[] = readdirSync(join(root, "packages")).filter((dir) => existsSync(join(root, "packages", dir, "package.json"))).map((dir) => {
  const json = require(join(root, "packages", dir, "package.json"));
  // its template, where it has one: the template's name and dependencies are the package's too
  const at = join(root, "packages", dir, "template", "package.json");
  const template = existsSync(at) ? require(at) : undefined;
  const deps = [...depsOf(json), ...(template ? depsOf(template) : [])];
  return { dir, names: [json.name, ...(template ? [template.name] : [])], deps, scripts: json.scripts ?? {} };
});
const byName = new Map(pkgs.flatMap((p) => p.names.map((name) => [name, p] as const)));

const changed = async (): Promise<string[]> => {
  const base = given ?? ((await $`git merge-base HEAD origin/main`.cwd(root).nothrow().quiet().text()).trim() || "HEAD");
  const lines = [
    await $`git diff --name-only ${base}`.cwd(root).quiet().text(),
    await $`git ls-files --others --exclude-standard`.cwd(root).quiet().text(),
  ].join("\n");
  return [...new Set(lines.split("\n").filter(Boolean))];
};

const files = args.has("--all") ? [] : await changed();
// a file outside packages/ (the lockfile, the root's package.json, a workflow) is every package's
const shared = files.some((f) => !f.startsWith("packages/") && /^(package\.json|bun\.lock|tsconfig\.json|scripts\/)/.test(f));
const touched = new Set(args.has("--all") || shared ? pkgs.map((p) => p.dir) : files.filter((f) => f.startsWith("packages/")).map((f) => f.split("/")[1]!));

// and every package that depends on one touched, transitively
let grew = true;
while (grew) {
  grew = false;
  for (const p of pkgs) {
    if (touched.has(p.dir)) continue;
    if (p.deps.some((d) => byName.has(d) && touched.has(byName.get(d)!.dir))) {
      touched.add(p.dir);
      grew = true;
    }
  }
}

/** The scripts a package runs for this change. */
function plan(p: Pkg): string[] {
  return [...(p.scripts["test:fast"] ? ["test:fast"] : []), ...(slow && p.scripts["test:slow"] ? ["test:slow"] : [])];
}

// what people and Claude read, held to the code, whatever changed: under a second (scripts/docs.ts)
// and every range a package gives a sibling includes the sibling's version here (scripts/ranges.ts)
const check = (script: string) => Bun.spawn(["bun", join(root, "scripts", script)], { cwd: root, stdout: "inherit", stderr: "inherit" }).exited;
// and the root's own scripts type-check (the root tsconfig.json)
const typed = () => Bun.spawn(["bun", "check"], { cwd: root, stdout: "inherit", stderr: "inherit" }).exited;
const docs = args.has("--dry-run") ? 0 : (await check("docs.ts")) || (await check("ranges.ts")) || (await typed());

const runs = pkgs.filter((p) => touched.has(p.dir)).map((p) => ({ p, scripts: plan(p) })).filter((r) => r.scripts.length);
if (runs.length === 0) {
  console.log(files.length ? "nothing to run: no package's files changed" : "nothing changed against origin/main");
  process.exit(docs);
}
for (const { p, scripts } of runs) console.log(`${p.dir}: ${scripts.join(", ")}`);
if (args.has("--dry-run")) process.exit(0);

// what each package's fast tier may take (test-budget.json): said when over, never a failure
const budget: Record<string, number> = existsSync(join(root, "test-budget.json")) ? require(join(root, "test-budget.json")) : {};
// a fixed sleep in a changed test file: wait on an event or waitFor instead (said, never a failure)
for (const f of files.filter((f) => /\.test\.tsx?$/.test(f) && existsSync(join(root, f)))) {
  const text = await Bun.file(join(root, f)).text();
  if (/setTimeout\(r, *\d|Bun\.sleep\(\d/.test(text)) console.log(`note ${f} waits a fixed time: wait on what it waits for`);
}

let failed: string[] = docs ? ["docs"] : [];
const started = performance.now();
for (const { p, scripts } of runs) {
  for (const script of scripts) {
    const t = performance.now();
    const proc = Bun.spawn(["bun", "run", script], { cwd: join(root, "packages", p.dir), stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    const secs = (performance.now() - t) / 1000;
    const over = script.startsWith("test:fast") && budget[p.dir] !== undefined && secs > budget[p.dir]! ? `, over its budget of ${budget[p.dir]}s` : "";
    console.log(`${code === 0 ? "ok  " : "FAIL"} ${p.dir} ${script} (${secs.toFixed(1)}s${over})`);
    if (code !== 0) failed.push(`${p.dir} ${script}`);
  }
}
console.log(`${failed.length ? `failed: ${failed.join("; ")}` : "all green"} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
