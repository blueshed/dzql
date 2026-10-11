#!/usr/bin/env bun

// Post-create setup: `bun create blueshed/paintbrush my-app` runs this as the
// template's postinstall, after `bun install` and before the first commit.
//
// It turns the template into an app. What is about developing the template goes
// (its ledger, its changelog, its logo, this script and its test); the app starts
// with fresh ones; its name replaces "Paintbrush"; and railroad's skill is copied
// into .claude/skills, so a session starts knowing how railroad's JSX behaves.

import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// The files that carry the app's name, as "Paintbrush" (the page title, which the
// test expects) or "paintbrush" (the Railway project, the dev server's name)
export const NAMED = [
  "src/index.html",
  "tests/site.test.ts",
  "CLAUDE.md",
  ".claude/launch.json",
  ".railway/railway.ts",
  "bun.lock", // the root package's name
];

// The template's own clone is the one place this must never run: it deletes things
function isTemplateClone(root: string) {
  const origin = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: root }).stdout.toString();
  return /blueshed\/paintbrush(\.git)?\s*$/.test(origin);
}

// bun create commits on a thread of its own while this script runs. Its `git add` can meet a
// file this script has just deleted ("unable to stat") and give up, leaving no commit at all,
// or commit before the skills are copied. So the last thing setup does is leave the repository
// committed, whatever bun create managed: no commit yet, make it; bun create's, amend it with
// everything; anything else is somebody's history, and is left alone.
async function commitEverything(root: string) {
  if (!existsSync(join(root, ".git"))) return; // bun create's git step has not started: it will see the finished folder
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });

  for (let attempt = 0; attempt < 10; attempt++) {
    const last = git("log", "-1", "--format=%s");
    const subject = last.exitCode === 0 ? last.stdout.toString().trim() : null; // null: no commits yet
    if (subject !== null && !/^initial commit/i.test(subject)) return;

    git("add", "-A");
    const committed =
      subject === null ? git("commit", "-q", "-m", "Initial commit (via bun create)") : git("commit", "-q", "--amend", "--no-edit");
    if (committed.exitCode === 0 || git("status", "--porcelain").stdout.toString() === "") return;
    await Bun.sleep(300); // an index.lock: bun create's own git step is still running
  }
}

export async function setup(root: string) {
  if (isTemplateClone(root)) throw new Error(`${root} is a clone of the paintbrush template: setup would delete its ledger and changelog`);

  const name = root.split("/").pop() || "my-app";
  console.log(`Setting up ${name}...`);

  for (const path of ["todo.jsonl", "CHANGELOG.md", "logo.png", "create", "tests/setup.test.ts", "evals"]) {
    rmSync(join(root, path), { recursive: true, force: true });
  }
  // The template's version goes in the changelog, so the app knows which of the template's changes
  // it has. The app's own version starts at 0.0.0, so its first `/release minor` makes 0.1.0.
  const pkg = Bun.file(join(root, "package.json"));
  const pkgText = (await pkg.exists()) ? await pkg.text() : "";
  const from = pkgText.match(/"version": "([^"]*)"/)?.[1];
  if (pkgText) await Bun.write(pkg, pkgText.replace(/"version": "[^"]*"/, '"version": "0.0.0"'));

  await Bun.write(join(root, "todo.jsonl"), "");
  await Bun.write(join(root, "CHANGELOG.md"), changelog(from));
  await Bun.write(join(root, "README.md"), readme(name));

  for (const path of NAMED) {
    const file = Bun.file(join(root, path));
    if (!(await file.exists())) continue;
    const text = (await file.text())
      .replace(/<!-- template -->[\s\S]*?<!-- \/template -->\n?/g, "") // notes for working on the template itself
      .replaceAll("Paintbrush", name)
      .replaceAll("paintbrush", name);
    await Bun.write(file, text);
  }

  // railroad's own skill. Its bun-route skill is not copied: it scaffolds a bare project with
  // `bun init`, and this app grows through its own evolve skill instead.
  const skill = join(root, "node_modules/@blueshed/railroad/.claude/skills/railroad");
  if (existsSync(skill)) {
    cpSync(skill, join(root, ".claude/skills/railroad"), { recursive: true });
    console.log("  copied railroad's skill into .claude/skills");
  } else {
    console.warn("  railroad's skill not found: after `bun install`, copy node_modules/@blueshed/railroad/.claude/skills/railroad into .claude/skills");
  }

  await commitEverything(root);

  console.log(`
  ${name} is ready!

  bun dev            # http://localhost:3000, hot reload
  bun run stop       # stop a server started in the background
  bun test           # tests, held at 100% coverage
  bun run typecheck  # bun check: TypeScript 7, built into Bun

  Read CLAUDE.md first: it says what is here. The evolve skill adds or changes a resource.
`);
}

const changelog = (from?: string) => `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Started from [paintbrush](https://github.com/blueshed/paintbrush)${from ? ` ${from}. To bring this app up to date, read [its changelog](https://github.com/blueshed/paintbrush/blob/main/CHANGELOG.md) from that version on` : ""}.
`;

const readme = (name: string) => `# ${name}

A Bun website of routes and resources, with railroad for the page and Railway for
the deploy, started from [paintbrush](https://github.com/blueshed/paintbrush).

Open it in two windows: a save in one shows in the other.

\`\`\`sh
bun dev            # http://localhost:3000, hot reload
bun run start      # the same source in production: nothing to build
bun test           # tests, held at 100% coverage
bun run typecheck
\`\`\`

\`CLAUDE.md\` says what is here and the rules. The \`evolve\` skill adds or changes a
resource: a route, a live push, SQLite, S3, a delta document.

\`CHANGELOG.md\` and \`todo.jsonl\` are a pair, the project's memory between sessions:
the changelog is where it has been, the ledger what is open now. When work lands it
gets a changelog entry, and the item it settles is marked fixed. \`/release\` turns
the unreleased entries into a version and takes the settled items out of the ledger.
`;

// Last, so the constants above exist when it runs. Only when run (bun create's
// postinstall), never on import: tests call setup() on a scratch folder.
if (import.meta.main) await setup(process.cwd());
