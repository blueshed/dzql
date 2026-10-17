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

const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: dest, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode;
if (!flags.has("--no-git")) run(["git", "init", "-q"]); // setup ends by making the first commit
if (flags.has("--no-install")) {
  console.log(`\nCopied to ${name}. Next: cd ${name} && bun install && bun create/setup.ts`);
  process.exit(0);
}
if (run([process.execPath, "install"]) !== 0) process.exit(1);
process.exit(run([process.execPath, "create/setup.ts"]));
