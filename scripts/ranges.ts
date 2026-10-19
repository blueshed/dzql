#!/usr/bin/env bun
/**
 * `bun scripts/ranges.ts`: every range a package (or create-dzql's template) gives a sibling
 * includes the sibling's version in this workspace. A range that no longer does resolves the
 * sibling from npm, an older release, and tests run against that (create-dzql's `dzql ^0.13.0`
 * did, after dzql 0.14.0). `bun run affected` runs it, beside the docs check.
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
if (wrong.length) {
  console.error(wrong.join("\n"));
  process.exit(1);
}
console.log(`ranges: every sibling range includes the workspace's version`);
