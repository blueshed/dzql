#!/usr/bin/env bun

// Post-create setup: `bun create blueshed my-app` (create-blueshed) runs this in the new folder,
// after `bun install`; it makes the first commit.
//
// It turns the template into an app. What is about developing the template goes (its
// ledger, this script, the template's own tests, the evolve skill's test with its script and CI
// step; its logo and evals/ were never copied, UNCOPIED); the app starts with a
// fresh ledger, changelog and README; its name replaces "Paintbrush"; and the skills its packages ship are copied into
// .claude/skills (delta's install-skills, below), so a session starts knowing how railroad's JSX
// behaves, how a document is kept and changed, and how stories are told.

import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

// The files that carry the app's name, as "Paintbrush" (the page title, which the
// test expects) or "paintbrush" (the Railway project, the dev server's name)
export const NAMED = [
  "src/index.html",
  "tests/site.test.ts",
  "CLAUDE.md",
  ".claude/launch.json",
  ".railway/railway.ts",
];

// What a new app never gets a copy of: what running the template makes, and what is about the
// template alone and setup does not need (its logo, the evolve skill's evaluations). create-blueshed
// leaves them out as it copies (cli.ts), and its package.json's `files` as it packs (a test holds the two to this list).
export const UNCOPIED = ["node_modules", "data", "tests/out", ".server.pid", "logo.png", "evals"];

/** The template copied to a new app's folder, as create-blueshed copies it (the evolve skill's test makes its apps with create-blueshed): all of it but UNCOPIED. */
export function copyTemplate(from: string, to: string): void {
  const copied = (src: string) => !UNCOPIED.some((path) => src === join(from, path) || src.startsWith(`${join(from, path)}/`));
  cpSync(from, to, { recursive: true, filter: copied });
}

/** The skills a new app takes from its packages, again on every install (`prepare`), so `bun update` brings theirs: delta's install-skills, but railroad's bun-route (it scaffolds a bare project with `bun init`; this app grows through its own evolve skill) and dzql's dzql-app (it builds a page the server draws). */
export const SKILLS = "delta install-skills --skip bun-route,dzql-app";

// What is about the template, not the app, that setup needs as it runs: copied, then deleted (a folder whole)
export const DELETED = ["todo.jsonl", "create", "tests/setup.test.ts", "tests/evolve.ts"];


// The template's own clone is the one place this must never run: it deletes things
function isTemplateClone(root: string) {
  if (!Bun.which("git")) return false; // no git, no clone
  const origin = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: root, stderr: "pipe" }).stdout.toString();
  return /blueshed\/(paintbrush|dzql)(\.git)?\s*$/.test(origin); // its old repository, or its home now
}

// create-blueshed makes the repository (`git init`) and leaves the first commit to this, the last
// step: everything setup wrote is in it. A repository with history is somebody's, and is left alone.
function commitEverything(root: string) {
  if (!existsSync(join(root, ".git")) || !Bun.which("git")) return; // no repository made (--no-git, no git, or inside another)
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  if (git("rev-parse", "--verify", "-q", "HEAD").exitCode === 0) return;
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit");
}

export async function setup(root: string) {
  if (isTemplateClone(root)) throw new Error(`${root} is a clone of the paintbrush template: setup would delete its ledger`);

  const name = root.split("/").pop() || "my-app";
  console.log(`Setting up ${name}...`);
  // npm leaves a package's .gitignore behind, so the template carries it without its dot
  if (existsSync(join(root, "gitignore"))) renameSync(join(root, "gitignore"), join(root, ".gitignore"));

  for (const path of DELETED) {
    rmSync(join(root, path), { recursive: true, force: true });
  }
  // create-blueshed's version (cli.ts writes it in as it copies; the template has none of its own)
  // goes in the changelog, so the app knows which of the template's changes it has. The app's own
  // version starts at 0.0.0, so its first `/release minor` makes 0.1.0.
  // The app's package.json: its name, its own version, and only the app's scripts. The template's
  // fast and slow tiers are the monorepo's (its slow one is the evolve skill's test, which goes);
  // an app's `bun test` is its whole proof.
  const pkgFile = Bun.file(join(root, "package.json"));
  const pkg = (await pkgFile.exists()) ? ((await pkgFile.json()) as { name?: string; version?: string; scripts?: Record<string, string> }) : undefined;
  const from = pkg?.version;
  if (pkg) {
    pkg.name = name;
    pkg.version = "0.0.0";
    if (pkg.scripts) {
      for (const script of ["test:evolve", "test:fast", "test:slow"]) delete pkg.scripts[script];
      pkg.scripts.test = "bun check && bun test";
      pkg.scripts.prepare = SKILLS;
    }
    await Bun.write(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const ci = Bun.file(join(root, ".github/workflows/ci.yml"));
  if (await ci.exists()) await Bun.write(ci, (await ci.text()).replace(/\n\n *# The evolve skill's sections[\s\S]*?run: bun run test:evolve\n/, "\n"));

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

  // The skills the app's packages ship (railroad's, delta's, and dzql's modelling, which package.json's
  // claudeSkills names): now, since `bun install` ran before the app had its `prepare` (SKILLS), and
  // by delta's bin, wherever a version keeps its code
  const cli = join(root, "node_modules/.bin/delta");
  const installed = existsSync(cli) && Bun.spawnSync([process.execPath, cli, ...SKILLS.split(" ").slice(1)], { cwd: root, stdout: "inherit", stderr: "inherit" }).exitCode === 0;
  if (!installed) console.warn(`  the skills are not installed: after \`bun install\`, run \`bunx ${SKILLS}\``);

  commitEverything(root);

  console.log(`
  ${name} is ready!

  bun dev            # http://localhost:3000, hot reload
  bun run stop       # stop a server started in the background
  bun test           # tests, held at 100% coverage
  bun run typecheck  # bun check: TypeScript 7, built into Bun
  bun run model      # http://localhost:3001: tell Claude your app's stories

  Read CLAUDE.md first: it says what is here. The evolve skill is how the app grows.
`);
}

const changelog = (from?: string) => `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Started from [create-blueshed](https://github.com/blueshed/dzql/tree/main/packages/create-blueshed)${from ? ` ${from}. To bring this app up to date, read [its changelog](https://github.com/blueshed/dzql/blob/main/packages/create-blueshed/CHANGELOG.md) from that version on` : ""}.
`;

export const readme = (name: string) => `# ${name}

**You write your stories, a schema and documents. You get a live page, and proof that every
story holds: on a JSON file today, on SQLite or Postgres later.**

## What you write

A story, in \`stories.ts\`: a sentence someone using the app could call true or false.

\`\`\`ts
// stories.ts
    follows: story("Anyone who opens the page sees the message, and a change made anywhere else shows in it, with nothing to reload."),
\`\`\`

A schema and a document, in \`src/resources/message/message-api.ts\`: the rows, and what someone
has in front of them.

\`\`\`ts
// src/resources/message/message-api.ts
export const schema = defineSchema({
  messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false },
});
export const docs = [defineDoc("message:", { root: "messages", include: [], implied: true })];
\`\`\`

A test named from the story, in \`tests/message.test.ts\`: its proof.

\`\`\`ts
// tests/message.test.ts
test(\`\${stories.stories.follows.name} -- the message is on the box and in its drawer, and a change made anywhere else shows in both\`, async () => {
\`\`\`

## What you get

\`\`\`sh
bun dev            # the live page, http://localhost:3000: open it in two windows, a save in one shows in the other
bun test           # the proof: every story is told by a test named from it, and coverage is 100%
\`\`\`

\`tests/stories.test.ts\` fails a story no test tells. The message keeps its rows in a JSON file;
the same \`defineSchema\` and \`defineDoc\` run on SQLite and Postgres, so moving changes the
import and carries the rows, and the page stays the same (the \`evolve\` skill).

## Your app

The message is there to show the pattern. Your app starts with its own stories:

\`\`\`sh
bun run model      # the model's page, http://localhost:3001: tell Claude the stories (the modelling skill)
\`\`\`

Each story lands on the model's page as it is told, with the documents it needs and what they
hold. When every story reads true, Claude writes them into \`stories.ts\` and builds them, the
least that makes the next one pass, growing the app with the \`evolve\` skill.

## Working on it

\`\`\`sh
bun run start      # the same source in production: nothing to build
bun run typecheck
\`\`\`

\`CLAUDE.md\` says what is here and the rules. The \`evolve\` skill is how the app grows: a new
document, two on one page, SQLite and then Postgres when they earn their place, migrations,
sign-in by link, HTTP routes for what isn't communication, and a build.

\`CHANGELOG.md\` and \`todo.jsonl\` are a pair, the project's memory between sessions:
the changelog is where it has been, the ledger what is open now. When work lands it
gets a changelog entry, and the item it settles is marked fixed. \`/release\` turns
the unreleased entries into a version and takes the settled items out of the ledger.
`;

// Last, so the constants above exist when it runs. Only when run (bun create's
// postinstall), never on import: tests call setup() on a scratch folder.
if (import.meta.main) await setup(process.cwd());
