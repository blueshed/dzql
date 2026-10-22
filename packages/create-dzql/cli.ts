#!/usr/bin/env bun
/**
 * `bun create dzql my-app`: eta's starter on dzql. The app is `template/`, beside this file: a whole
 * working app laid out as a new one is (its stories at the root, `src/` its routes, page and store,
 * no resources yet, `tests/`), a workspace of blueshed/dzql tested where it lives, and published as
 * it is. This copies it, but for what running it makes (package.json's `files` leaves the same out
 * of the tarball, and this reads it there), names the app, gives it its skills on every install, a
 * changelog and a ledger, and says what to run. Its `Dockerfile` is how it deploys. Then, as create-blueshed does: `bun install` (which
 * installs the skills), and the app's first commit.
 *
 *   --no-install   copy only: then `bun install` in the new folder
 *   --no-git       no repository (none is made without git, or inside a repository already)
 *   --local        (or BLUESHED_LOCAL=1) railroad, delta and dzql from the blueshed/dzql checkout this
 *                  runs from, not npm: for trying the packages as they are, before a release
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("-")) ?? "my-dzql-app";
const flags = new Set(args.filter((a) => a.startsWith("-")));
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`"${name}" is not a name for an app: lower case letters, digits and dashes`);
  process.exit(1);
}
const dest = join(process.cwd(), name);
if (existsSync(dest)) {
  console.error(`Error: "${name}" already exists`);
  process.exit(1);
}
const template = join(import.meta.dir, "template");
const own = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf8")) as { version: string; files: string[] };
// what running the template makes (its node_modules, its data), never a new app's: as `files` leaves it out of the tarball
const left = own.files.filter((f) => f.startsWith("!template/")).map((f) => new Bun.Glob(f.slice("!template/".length)));

console.log(`Creating ${name}...`);
cpSync(template, dest, { recursive: true, filter: (src) => !left.some((glob) => glob.match(relative(template, src))) });

// the project's memory, as a paintbrush app starts with: where it has been, and what is open
writeFileSync(join(dest, "CHANGELOG.md"), `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\n\n## [Unreleased]\n\n- Started from create-dzql ${own.version}.\n`);
writeFileSync(join(dest, "todo.jsonl"), "");

// npm leaves dotfiles of a package behind: they travel without their dot
renameSync(join(dest, "gitignore"), join(dest, ".gitignore"));
renameSync(join(dest, "env.test"), join(dest, ".env.test"));
renameSync(join(dest, "dockerignore"), join(dest, ".dockerignore"));

// The app's package.json, as paintbrush's setup writes one: its name, and the skills its packages
// ship, again on every install (`prepare`; the template has none, or installing the workspace would write them into it)
const pkgFile = join(dest, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
pkg.name = name;
pkg.scripts.prepare = "delta install-skills";
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");

// The app's name in place of the starter's own, in every file
const title = name.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => (dash ? " " : "") + c.toUpperCase());
const named = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) named(path);
    else {
      const text = readFileSync(path, "utf8");
      const next = text.replaceAll("Starter", title).replace('name: "starter"', `name: "${name}"`);
      if (next !== text) writeFileSync(path, next);
    }
  }
};
named(dest);

// --local: the app takes railroad, delta and dzql from this checkout's packages, and keeps them when a
// step adds one again: overrides win over what npm has
if (flags.has("--local") || process.env.BLUESHED_LOCAL) {
  const packages = join(import.meta.dir, "..");
  const local: Record<string, string> = { "@blueshed/railroad": "railroad", "@blueshed/delta": "delta", dzql: "dzql" };
  if (!Object.values(local).every((dir) => existsSync(join(packages, dir, "package.json")))) {
    console.error("Error: --local runs from a blueshed/dzql checkout (packages/create-dzql), beside railroad, delta and dzql");
    process.exit(1);
  }
  const overrides: Record<string, string> = {};
  for (const [dep, dir] of Object.entries(local)) {
    overrides[dep] = `file:${join(packages, dir)}`;
    if (pkg.dependencies?.[dep]) pkg.dependencies[dep] = overrides[dep];
  }
  pkg.overrides = { ...pkg.overrides, ...overrides };
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  console.log("  railroad, delta and dzql from this checkout (--local)");
}

// The app is its own repository, unless it is asked not to be, git is not there, or the folder is
// already inside one (an app made in a monorepo is that repository's)
const run = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: dest, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode;
const git = Bun.which("git");
const inside = git && Bun.spawnSync([git, "rev-parse", "--is-inside-work-tree"], { cwd: dirname(dest), stdout: "pipe", stderr: "pipe" }).exitCode === 0;
const repo = !flags.has("--no-git") && !!git && !inside;
if (!flags.has("--no-git") && !git) console.log("  git not found: no repository made");
else if (!flags.has("--no-git") && inside) console.log("  already inside a git repository: no repository of its own");
if (repo) run([git!, "init", "-q"]);
if (!flags.has("--no-install") && run([process.execPath, "install"]) !== 0) process.exit(1);
if (repo) {
  run([git!, "add", "-A"]);
  run([git!, "commit", "-q", "-m", "Initial commit"]);
}

console.log(`
Done. To start:

  cd ${name}${flags.has("--no-install") ? "\n  bun install        # and the skills: CLAUDE.md says which" : ""}
  bun dev            # http://localhost:3000: the page, waiting for its first story;
                     # and /model, the model's page, where the stories are told first
  bun test           # the page is served and drawn, and every story passes
`);
