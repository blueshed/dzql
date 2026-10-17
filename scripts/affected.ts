#!/usr/bin/env bun
/**
 * `bun run affected`: the gate for what a change touches. The packages whose files changed (against
 * origin/main: commits not pushed, staged, unstaged, untracked), and every package that depends on
 * one of them, each run its fast tier: a type check and the tests that need no browser and no
 * Postgres server. `--slow` runs the slow tier too (the browser tests, dzql's Postgres suite in
 * Docker, eta's stories and costs): CI runs it on every push, and it runs before a release.
 * `--all` runs every package. `--dry-run` says what would run.
 *
 * A package says its tiers in its package.json: `test:fast`, and `test:slow`. Within dzql, a change
 * only to eta's half (src/rendering, src/modelling, its examples) runs that half's fast tier
 * (`test:fast:eta`), and one only to the Postgres half runs that half's (`test:fast:pg`).
 */
import { $ } from "bun";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const slow = args.has("--slow");

type Pkg = { dir: string; name: string; deps: string[]; scripts: Record<string, string> };
const pkgs: Pkg[] = readdirSync(join(root, "packages")).filter((dir) => existsSync(join(root, "packages", dir, "package.json"))).map((dir) => {
  const json = require(join(root, "packages", dir, "package.json"));
  const deps = Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.peerDependencies });
  return { dir, name: json.name, deps, scripts: json.scripts ?? {} };
});
const byName = new Map(pkgs.map((p) => [p.name, p]));

const changed = async (): Promise<string[]> => {
  const base = (await $`git merge-base HEAD origin/main`.cwd(root).nothrow().quiet().text()).trim() || "HEAD";
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
  const own = files.filter((f) => f.startsWith(`packages/${p.dir}/`)).map((f) => f.slice(`packages/${p.dir}/`.length));
  const fast = (() => {
    if (p.scripts["test:fast:eta"] && p.scripts["test:fast:pg"] && own.length && !shared && own.length === files.filter((f) => f.startsWith("packages/")).length) {
      const eta = own.every((f) => /^(src\/(rendering|modelling)\/|examples\/(?!delta\/)|docs\/eta\/|\.claude\/skills\/)/.test(f));
      const pg = own.every((f) => /^(src\/(compile|postgres|sql|cli)\/|tests\/|examples\/delta\/|bench\/|docs\/delta\/)/.test(f));
      if (eta) return ["test:fast:eta"];
      if (pg) return ["test:fast:pg"];
    }
    return p.scripts["test:fast"] ? ["test:fast"] : [];
  })();
  return [...fast, ...(slow && p.scripts["test:slow"] ? ["test:slow"] : [])];
}

const runs = pkgs.filter((p) => touched.has(p.dir)).map((p) => ({ p, scripts: plan(p) })).filter((r) => r.scripts.length);
if (runs.length === 0) {
  console.log(files.length ? "nothing to run: no package's files changed" : "nothing changed against origin/main");
  process.exit(0);
}
for (const { p, scripts } of runs) console.log(`${p.dir}: ${scripts.join(", ")}`);
if (args.has("--dry-run")) process.exit(0);

let failed: string[] = [];
const started = performance.now();
for (const { p, scripts } of runs) {
  for (const script of scripts) {
    const t = performance.now();
    const proc = Bun.spawn(["bun", "run", script], { cwd: join(root, "packages", p.dir), stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    console.log(`${code === 0 ? "ok  " : "FAIL"} ${p.dir} ${script} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
    if (code !== 0) failed.push(`${p.dir} ${script}`);
  }
}
console.log(`${failed.length ? `failed: ${failed.join("; ")}` : "all green"} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
