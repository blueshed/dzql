#!/usr/bin/env bun
/**
 * `bun create dzql my-app`: eta's starter on dzql. The app is `src/`, begun as dzql's
 * `examples/starter` (its routes and its page, no stories yet, no resources yet), served by delta's
 * one server from its own `routes.ts`. Copies `template/` (the app's package.json, tsconfig, README), then the
 * starter into `src/`, puts the app's name in, and says what to run.
 *
 * The starter is dzql's own, copied in when this package is packed (`prepack`, as `starter/`); run
 * from the repository it is read where it lives, so the two never differ. Then, as create-blueshed
 * does: `bun install` (which installs the skills), and the app's first commit.
 *
 *   --no-install   copy only: then `bun install` in the new folder
 *   --no-git       no repository (none is made without git, or inside a repository already)
 *   --local        (or BLUESHED_LOCAL=1) railroad, delta and dzql from the blueshed/dzql checkout this
 *                  runs from, not npm: for trying the packages as they are, before a release
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
const packed = join(import.meta.dir, "starter");
const starter = existsSync(packed) ? packed : join(import.meta.dir, "../dzql/examples/starter");

console.log(`Creating ${name}...`);
cpSync(join(import.meta.dir, "template"), dest, { recursive: true });
cpSync(starter, join(dest, "src"), { recursive: true });

// a dzql app is laid out as a paintbrush app is: its stories at the root, its tests in tests/
renameSync(join(dest, "src/stories.ts"), join(dest, "stories.ts"));
mkdirSync(join(dest, "tests"));
const test = readFileSync(join(dest, "src/routes.test.ts"), "utf8").replace('from "./stories"', 'from "../stories"').replace('from "./routes"', 'from "../src/routes"');
writeFileSync(join(dest, "tests/routes.test.ts"), test);
rmSync(join(dest, "src/routes.test.ts"));

// the project's memory, as a paintbrush app starts with: where it has been, and what is open
const version = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf8")).version;
writeFileSync(join(dest, "CHANGELOG.md"), `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\n\n## [Unreleased]\n\n- Started from create-dzql ${version}.\n`);
writeFileSync(join(dest, "todo.jsonl"), "");

// npm leaves dotfiles of a package behind: they travel without their dot
renameSync(join(dest, "gitignore"), join(dest, ".gitignore"));
renameSync(join(dest, "env.test"), join(dest, ".env.test"));

// The starter's look imports the kernel's bento by a path inside dzql; in an app it is by name
const styles = join(dest, "src/styles.css");
writeFileSync(styles, readFileSync(styles, "utf8").replace(/@import "[^"]*src\/rendering\/(bento(?:-plain)?\.css)";/, '@import "dzql/rendering/$1";'));

// The app's name in place of {{name}}, and of the starter's own, in every file
const title = name.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => (dash ? " " : "") + c.toUpperCase());
const named = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) named(path);
    else {
      const text = readFileSync(path, "utf8");
      const next = text.replaceAll("{{name}}", name).replaceAll("Starter", title).replace('name: "starter"', `name: "${name}"`);
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
  const pkgFile = join(dest, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
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
