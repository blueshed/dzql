#!/usr/bin/env bun

// Post-create setup: `bun create blueshed/eta my-app` runs this as the template's postinstall,
// after `bun install` and before the first commit. It turns a copy of eta into a project of its
// own, as paintbrush's does:
//
//   src/     eta's kernel, as it is -- the app imports it and never edits it, so a later eta is
//            this folder replaced whole, and the changelog's "What to change" carried across
//   model/   the modeling page (eta's examples/modeling): the project's own model, empty, kept
//            while its stories are told
//   app/     the app, as the starter begins it (eta's examples/starter): built from the model
//
// What is about developing eta goes: its other examples, the modeller, its history, its ledger,
// changelog and release command, the kernel's own tests, and this script. The project starts with
// a fresh ledger and changelog (naming the eta it started from), a `.env` that names its model and
// the password the two who keep it share, and delta's and railroad's skills beside eta's.

import { cpSync, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** The skills a project starts with from the packages that ship them, beside eta's own (eta-app, modelling). */
const SKILLS = [
  ["@blueshed/railroad", "railroad"],
  ["@blueshed/delta", "delta-doc"],
] as const;

/** What only developing eta needs. */
const ETA_ONLY = ["examples", "modeller", "history", "create", "first-app.md", "todo.jsonl", "CHANGELOG.md", ".claude/commands/publish.md", ".env.example"];

/** eta's own clone is the one place this must never run: it deletes things. */
function isTemplateClone(root: string): boolean {
  const origin = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: root }).stdout.toString();
  return /blueshed\/eta(\.git)?\s*$/.test(origin);
}

/** Every file under `dir`, recursively. */
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const at = join(dir, f);
    return statSync(at).isDirectory() ? filesIn(at) : [at];
  });
}

/** A file's text, changed by `fn`, written back. */
async function rewrite(path: string, fn: (text: string) => string): Promise<void> {
  const file = Bun.file(path);
  await Bun.write(file, fn(await file.text()));
}

/** An example moved up a level, to the project's root: its imports of the kernel follow it, one `../` fewer at each depth. */
async function lift(root: string, from: string, to: string): Promise<void> {
  renameSync(join(root, from), join(root, to));
  for (const path of filesIn(join(root, to)).filter((f) => /\.(ts|tsx|css|html)$/.test(f))) {
    const depth = path.slice(join(root, to).length + 1).split("/").length - 1;
    await rewrite(path, (text) => text.replaceAll(`${"../".repeat(depth + 2)}src/`, `${"../".repeat(depth + 1)}src/`));
  }
}

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Who tells the stories: the first name git knows, or "You". */
function teller(root: string): string {
  const name = Bun.spawnSync(["git", "config", "user.name"], { cwd: root }).stdout.toString().trim().split(/\s+/)[0];
  return name && /^[\w-]+$/.test(name) ? title(name) : "You";
}

/**
 * Leaves the project committed, whatever bun create managed: it commits on a thread of its own
 * while this runs, and may meet a file just deleted, or commit before the skills are copied. No
 * commit yet, make it; bun create's, amend it with everything; anything else is somebody's history.
 */
async function commitEverything(root: string): Promise<void> {
  if (!existsSync(join(root, ".git"))) return; // bun create's git step has not started: it will see the finished folder
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root });
  for (let attempt = 0; attempt < 10; attempt++) {
    const last = git("log", "-1", "--format=%s");
    const subject = last.exitCode === 0 ? last.stdout.toString().trim() : null;
    if (subject !== null && !/^initial commit/i.test(subject)) return;
    git("add", "-A");
    const committed = subject === null ? git("commit", "-q", "-m", "Initial commit (via bun create)") : git("commit", "-q", "--amend", "--no-edit");
    if (committed.exitCode === 0 || git("status", "--porcelain").stdout.toString() === "") return;
    await Bun.sleep(300); // an index.lock: bun create's own git step is still running
  }
}

export async function setup(root: string): Promise<void> {
  if (isTemplateClone(root)) throw new Error(`${root} is a clone of eta itself: setup would delete its examples, ledger and changelog`);
  const name = (root.split("/").pop() || "my-app").toLowerCase();
  const Name = title(name);
  console.log(`Setting up ${name}...`);
  const eta = (await Bun.file(join(root, "package.json")).json()) as { version: string; dependencies: Record<string, string>; devDependencies: Record<string, string>; packageManager: string; engines: Record<string, string> };

  await lift(root, "examples/starter", "app");
  await lift(root, "examples/modeling", "model");
  rmSync(join(root, "model/server.test.ts")); // eta's test of it: the model page is eta's, tested there
  for (const path of ["app/index.ts", "app/page.ts", "app/client/index.html", "app/client/styles.css"]) await rewrite(join(root, path), (t) => t.replaceAll("Starter", Name).replaceAll("starter", name));
  for (const path of ETA_ONLY) rmSync(join(root, path), { recursive: true, force: true });
  for (const path of filesIn(join(root, "src")).filter((f) => /\.test\.|\.test-|test\.fixture/.test(f))) rmSync(path); // the kernel's tests are eta's

  await Bun.write(
    join(root, "package.json"),
    JSON.stringify(
      {
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        packageManager: eta.packageManager,
        engines: eta.engines,
        scripts: {
          dev: "ETA_EXAMPLE=./app bun --watch src/start.ts",
          model: "ETA_EXAMPLE=./model PORT=3001 bun --watch src/start.ts",
          start: "NODE_ENV=production ETA_EXAMPLE=./app bun src/start.ts",
          cli: "ETA_EXAMPLE=./app bun src/cli.ts",
          "cli:model": "ETA_EXAMPLE=./model ETA_URL=ws://localhost:3001 bun src/cli.ts",
          check: "bun check",
          test: "bun test",
          stories: "ETA_EXAMPLE=./app bun --env-file=.env.test src/stories-run.ts",
          "stories:hand": "STORY_BY_HAND=1 ETA_EXAMPLE=./app bun --env-file=.env.test src/stories-run.ts",
        },
        dependencies: eta.dependencies,
        devDependencies: eta.devDependencies,
      },
      null,
      2,
    ) + "\n",
  );
  await rewrite(join(root, "bun.lock"), (t) => t.replace('"name": "eta"', `"name": "${name}"`)); // the root package's name
  await Bun.write(join(root, "bunfig.toml"), BUNFIG);
  await rewrite(join(root, "tsconfig.json"), (t) => t.replace(/"include": \[[^\]]*\]/, '"include": ["src", "app", "model"]'));
  await Bun.write(join(root, ".env"), `# ${name}'s model (bun run model): its name, who keeps it, and the password they share -- each signs in\n# as <their name, in lower case>@modeling.example. Not committed.\nMODEL_NAME=${Name}\nMODEL_PEOPLE=${teller(root)},Claude\nMODEL_PASSWORD=${crypto.randomUUID()}\n`);
  await Bun.write(join(root, ".claude/launch.json"), LAUNCH(name));
  await Bun.write(join(root, "todo.jsonl"), "");
  await Bun.write(join(root, "CHANGELOG.md"), changelog(eta.version));
  await Bun.write(join(root, "README.md"), readme(Name));
  await rewrite(join(root, "CLAUDE.md"), () => claude(Name));

  for (const [pkg, skill] of SKILLS) {
    const from = join(root, `node_modules/${pkg}/.claude/skills/${skill}`);
    if (existsSync(from)) cpSync(from, join(root, ".claude/skills", skill), { recursive: true });
    else console.warn(`  ${pkg}'s ${skill} skill not found: after \`bun install\`, copy node_modules/${pkg}/.claude/skills/${skill} into .claude/skills`);
  }

  await commitEverything(root);

  console.log(`
  ${name} is ready!

  bun run model      # the model, on http://localhost:3001 -- sign in from .env
  bun dev            # the app, on http://localhost:3000
  bun test           # the app's tests, held at 100% coverage
  bun run stories    # the app's stories

  Tell Claude the first story. Read CLAUDE.md first: it says what is here.
`);
}

const BUNFIG = `[test]
# coverage is always on, and 100% is a gate: the run fails below it. It covers the app (app/):
# src/ is eta's kernel and model/ eta's modeling page, each tested in eta itself.
coverage = true
coverageThreshold = 1.0
coveragePathIgnorePatterns = ["**/node_modules/**", "src/**", "model/**", "app/stories.ts"]
`;

const LAUNCH = (name: string) => `{
  "version": "0.0.1",
  "configurations": [
    { "name": "${name}", "runtimeExecutable": "bun", "runtimeArgs": ["run", "dev"], "port": 3000 },
    { "name": "model", "runtimeExecutable": "bun", "runtimeArgs": ["run", "model"], "port": 3001 }
  ]
}
`;

const changelog = (from: string) => `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Started from [eta](https://github.com/blueshed/eta) ${from}. To bring the kernel (\`src/\`) and the model's page (\`model/\`) up to date, read [eta's changelog](https://github.com/blueshed/eta/blob/main/CHANGELOG.md) from that version on: replace both folders with the later eta's, and carry across what its "What to change" says for the app.
`;

const readme = (Name: string) => `# ${Name}

An app on [eta](https://github.com/blueshed/eta): its pages are drawn on the server from the
documents people hold, and every change anyone makes reaches everyone holding it, as it happens.

It is told before it is built. You tell the stories -- who does what, and who then sees it -- and
Claude models them on the model's page while you watch: the documents they need, what each holds,
who holds it, and the entities that follow. Then Claude builds the app from the model, the least
that makes each story pass.

\`\`\`sh
bun run model      # the model, on http://localhost:3001: sign in with a name and the password in .env
bun dev            # the app, on http://localhost:3000
bun test           # the app's tests, held at 100% coverage
bun run stories    # the app's stories, each over real sockets, with its undo and redo
\`\`\`

\`CLAUDE.md\` says what is here and the rules.
`;

const claude = (Name: string) => `# CLAUDE.md

${Name}: an app on eta, told before it is built.

## What is here

- \`model/\`: the model's page (\`bun run model\`, port 3001). You tell the stories; Claude writes
  them down and describes the documents they need with \`bun run cli:model\`, and the page shows
  each change as it lands. Load the **modelling** skill before writing to it.
- \`app/\`: the app (\`bun dev\`, port 3000), built from the model. Load the **eta-app** skill before
  adding a document, a compartment, an applet or a route.
- \`src/\`: eta's kernel. The app imports it and never edits it. To update it, replace \`src/\` and
  \`model/\` with a later eta's, and carry across what eta's changelog says to change (CHANGELOG.md
  says which eta this started from).

## Working here

- Bun only: never \`node\`, \`npm\` or \`yarn\`.
- Stories first: a story in \`app/stories.ts\`, modelled on the model's page, then the least that
  makes it pass. Build nothing no story needs.
- The gate before a commit: \`bun check\`, \`bun test\` (100% coverage of \`app/\`), \`bun run stories\`.
- \`todo.jsonl\` is what is open; \`CHANGELOG.md\` is where the app has been. They move together.
- No new dependencies without asking.

## The wire

- HTML is the only vocabulary; the server is the only renderer.
- A write names a document and a JSON Pointer path, never a function name.
- A page is told only what it read, and sent only the parts that changed.
`;

// Last, so the constants above exist when it runs. Only when run (bun create's postinstall), never on
// import: eta's test calls setup() on a scratch copy.
if (import.meta.main) await setup(process.cwd());
