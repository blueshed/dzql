#!/usr/bin/env bun
/**
 * `bun scripts/ranges.ts`: every range a package (or create-dzql's template) gives a sibling
 * includes the sibling's version in this workspace. A range that no longer does resolves the
 * sibling from npm, an older release, and tests run against that (create-dzql's `dzql ^0.13.0`
 * did, after dzql 0.14.0). `bun run affected` runs it, beside the docs check.
 *
 * And the Bun every package is made on, said once: the root's `packageManager` (which CI reads,
 * `.github/actions/setup`). A package's types (`@types/bun`, `^` it) and
 * a new app's own `packageManager` follow it. A package's floor (`engines.bun`) is its own, lower
 * where it runs on an older Bun (railroad's, which publish.yml's floor job runs on), and its README's
 * "Bun <version> or later" says that floor.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const files = readdirSync(join(root, "packages")).map((dir) => `packages/${dir}/package.json`).filter((f) => existsSync(join(root, f)));
const read = (f: string) => JSON.parse(readFileSync(join(root, f), "utf8"));
const versions = new Map<string, string>(files.map((f) => [read(f).name, read(f).version]));

const wrong: string[] = [];
for (const f of [...files, "packages/create-dzql/template/package.json"]) {
  const json = read(f);
  for (const field of ["dependencies", "devDependencies", "peerDependencies"])
    for (const [name, range] of Object.entries((json[field] ?? {}) as Record<string, string>)) {
      const version = versions.get(name);
      if (!version || range.startsWith("workspace:") || range.startsWith("link:")) continue;
      if (!Bun.semver.satisfies(version, range)) wrong.push(`${f}: ${field} ${name} ${range} leaves out ${version}, the workspace's`);
    }
}
const bun = /^bun@(\d+\.\d+\.\d+)$/.exec(read("package.json").packageManager ?? "")?.[1];
if (!bun) wrong.push(`package.json: packageManager must be bun@<an exact version>`);
else
  for (const f of ["package.json", ...files, "packages/create-dzql/template/package.json"]) {
    const json = read(f);
    const said: [string, string | undefined, string][] = [
      ["@types/bun", json.devDependencies?.["@types/bun"], `^${bun}`],
      ["packageManager", json.packageManager, `bun@${bun}`],
    ];
    for (const [what, is, want] of said) if (is !== undefined && is !== want) wrong.push(`${f}: ${what} is ${is}, not ${want} (the root's packageManager)`);
    const readme = f.replace(/package\.json$/, "README.md");
    const floor = /^>=(\S+)$/.exec(json.engines?.bun ?? "")?.[1];
    for (const m of existsSync(join(root, readme)) ? readFileSync(join(root, readme), "utf8").matchAll(/Bun (\d+\.\d+\.\d+) or later/g) : [])
      if (m[1] !== floor) wrong.push(`${readme}: says Bun ${m[1]} or later, its package.json's floor is ${json.engines?.bun ?? "none"}`);
  }
if (wrong.length) {
  console.error(wrong.join("\n"));
  process.exit(1);
}
console.log(`ranges: every sibling range includes the workspace's version, and every package is made on Bun ${bun}, and each README says its floor`);
