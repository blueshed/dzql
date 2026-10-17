// Post-create setup: `bun create blueshed/eta my-app` runs this as the template's postinstall,
// after `bun install` and before the first commit. It turns a copy of eta into a project of its
// own, as paintbrush's does. The root is the app; eta is one folder, never edited:
//
//   src/          the app, as the starter begins it (eta's examples/starter), importing eta by name
//   migrations/   a field renamed or dropped, or data moved: delta's migrate runs them
//   eta/          eta's kernel, model page, docs, changelog and version (create/eta.ts makes it):
//                 a Bun workspace named eta, so the app imports `eta/stories`, `eta/bento.css`;
//                 `bun run eta:update` replaces it whole with a later eta and says what to change
//
// What is about developing eta goes: its other examples, its docs, ledger, changelog and release
// command, and this script. The project starts with a fresh ledger and changelog (naming the eta
// it started from), a `.env` that names its model and the password the two who keep it share, and
// delta's and railroad's skills beside eta's.

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BUNFIG, claude, importEta, makeEta, MIGRATIONS_README, projectPackage, refreshSkills, title, TSCONFIG_INCLUDE } from "./eta";

/** What only developing eta needs: eta/ has what a project keeps of it. */
const ETA_ONLY = ["examples", "create", "docs", "todo.jsonl", "CHANGELOG.md", ".claude/commands/publish.md", ".env.example"];

/** eta's own clone is the one place this must never run: it deletes things. */
function isTemplateClone(root: string): boolean {
  const origin = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: root }).stdout.toString();
  return /blueshed\/eta(\.git)?\s*$/.test(origin);
}

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
  const eta = (await Bun.file(join(root, "package.json")).json()) as Parameters<typeof projectPackage>[1];

  // eta/, from this copy of eta, as eta:update makes it from a later one; then the kernel goes from the root, and the starter takes its place
  const version = await makeEta(root, join(root, "eta"));
  rmSync(join(root, "src"), { recursive: true });
  renameSync(join(root, "examples/starter"), join(root, "src"));
  await importEta(join(root, "src"), 2);
  for (const path of ["src/index.ts", "src/page.ts", "src/client/index.html", "src/client/styles.css", "src/client/main.ts"]) {
    const file = Bun.file(join(root, path));
    await Bun.write(file, (await file.text()).replaceAll("Starter", Name).replaceAll("starter", name));
  }
  for (const path of ETA_ONLY) rmSync(join(root, path), { recursive: true, force: true });
  mkdirSync(join(root, "migrations"));
  await Bun.write(join(root, "migrations/README.md"), MIGRATIONS_README);

  const pkg = projectPackage({ name, version: "0.0.0", private: true, type: "module", dependencies: eta.dependencies, devDependencies: eta.devDependencies }, eta);
  await Bun.write(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  await Bun.write(join(root, "bunfig.toml"), BUNFIG);
  const tsconfig = Bun.file(join(root, "tsconfig.json"));
  await Bun.write(tsconfig, (await tsconfig.text()).replace(/"include": \[[^\]]*\]/, TSCONFIG_INCLUDE));
  await Bun.write(join(root, ".env"), `# ${name}'s model (bun run model): its name, who keeps it, and the password they share -- each signs in\n# as <their name, in lower case>@modeling.example. Not committed.\nMODEL_NAME=${Name}\nMODEL_PEOPLE=${teller(root)},Claude\nMODEL_PASSWORD=${crypto.randomUUID()}\n`);
  await Bun.write(join(root, ".claude/launch.json"), LAUNCH(name));
  await Bun.write(join(root, "todo.jsonl"), "");
  await Bun.write(join(root, "CHANGELOG.md"), changelog(version));
  await Bun.write(join(root, "README.md"), readme(Name));
  await Bun.write(join(root, "CLAUDE.md"), claude(Name));

  // eta is a workspace now (eta/package.json): install again, so node_modules/eta is it
  const install = Bun.spawnSync(["bun", "install"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode !== 0) console.warn(`  bun install failed: run it again in ${name}\n${install.stderr.toString()}`);
  for (const missing of refreshSkills(root, root)) console.warn(`  ${missing}`);

  await commitEverything(root);

  console.log(`
  ${name} is ready!

  bun run model       # the model, on http://localhost:3001 -- sign in from .env
  bun dev             # the app (src/), on http://localhost:3000
  bun test            # the app's tests, held at 100% coverage
  bun run stories     # the app's stories
  bun run eta:update  # a later eta: eta/ replaced whole, and what to change

  Tell Claude the first story. Read CLAUDE.md first: it says what is here.
`);
}

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

- Started from [eta](https://github.com/blueshed/eta) ${from.replace("+unreleased", ", with what its changelog had under Unreleased then")}. \`eta/\` is eta's, never edited: \`bun run eta:update\` brings a later eta, says what to change, and runs the gate.
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
bun run eta:update # a later eta, and what to change for it
\`\`\`

- \`src/\`: the app -- its stories, documents, compartments, page and client.
- \`migrations/\`: a field renamed or dropped, or data moved.
- \`eta/\`: eta, never edited here. \`bun run eta:update\` replaces it with a later eta.

\`CLAUDE.md\` says more, and the rules.
`;

// Last, so the constants above exist when it runs. Only when run (bun create's postinstall), never on
// import: eta's test calls setup() on a scratch copy.
if (import.meta.main) await setup(process.cwd());
