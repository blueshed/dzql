#!/usr/bin/env bun
/**
 * create-blueshed: `bun create blueshed my-app` (or `bunx create-blueshed my-app`) makes a
 * paintbrush app: routes and resources, railroad for the page, delta for the documents, Railway
 * for the deploy. The app is `packages/paintbrush` in blueshed/dzql, a working app with its own
 * tests; publishing this package copies it in as `template/`. This copies it to the new folder,
 * installs, then runs paintbrush's own setup (`create/setup.ts`): the app's name, a fresh ledger
 * and changelog, railroad's and delta's skills, and one first commit.
 *
 *   --no-install   copy only: then `bun install && bun create/setup.ts` in the new folder
 *   --no-git       no repository
 *   --local        (or BLUESHED_LOCAL=1) railroad, delta and dzql from the blueshed/dzql checkout this
 *                  runs from, not npm: for trying the packages as they are, before a release
 */
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("-")) ?? "my-app";
const flags = new Set(args.filter((a) => a.startsWith("-")));
const dest = resolve(name);
if (existsSync(dest)) {
  console.error(`Error: "${name}" already exists`);
  process.exit(1);
}

// published, paintbrush is beside this file; in blueshed/dzql it is its sibling package
const template = [join(import.meta.dir, "template"), join(import.meta.dir, "../paintbrush")].find((dir) => existsSync(dir))!;
const skip = /^\/(node_modules|data|tests\/out)(\/|$)|^\/\.server\.pid$/;
cpSync(template, dest, { recursive: true, filter: (src) => !skip.test(src.slice(template.length)) });

// --local: the app takes railroad, delta and dzql from this checkout's packages, and keeps them when a
// step adds one again (`bun add dzql`): overrides win over what npm has
if (flags.has("--local") || process.env.BLUESHED_LOCAL) {
  const local: Record<string, string> = { "@blueshed/railroad": "railroad", "@blueshed/delta": "delta", dzql: "dzql" };
  const packages = join(import.meta.dir, "..");
  if (!Object.values(local).every((dir) => existsSync(join(packages, dir, "package.json")))) {
    console.error("Error: --local runs from a blueshed/dzql checkout (packages/create-blueshed), beside railroad, delta and dzql");
    process.exit(1);
  }
  const pkgFile = join(dest, "package.json");
  const pkg = await Bun.file(pkgFile).json();
  const overrides: Record<string, string> = {};
  for (const [name, dir] of Object.entries(local)) {
    overrides[name] = `file:${join(packages, dir)}`;
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = overrides[name];
  }
  pkg.overrides = { ...pkg.overrides, ...overrides };
  await Bun.write(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  console.log("  railroad, delta and dzql from this checkout (--local)");
}

const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: dest, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode;
if (!flags.has("--no-git")) run(["git", "init", "-q"]); // setup ends by making the first commit
if (flags.has("--no-install")) {
  console.log(`\nCopied to ${name}. Next: cd ${name} && bun install && bun create/setup.ts`);
  process.exit(0);
}
if (run([process.execPath, "install"]) !== 0) process.exit(1);
process.exit(run([process.execPath, "create/setup.ts"]));
