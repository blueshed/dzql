// eta/: the one folder of eta a project keeps, never edited, made from an eta checkout (a `bun
// create` copy, a release's tarball, a clone). create/setup.ts makes it when a project is made;
// `bun run eta:update` (create/update.ts, a project's eta/update.ts) makes it again from a later
// eta with that eta's own copy of this file, so each eta says how its eta/ is made, and how a
// project's root follows it. It imports nothing but Bun's and node's own: it runs from wherever
// the checkout was unpacked.
//
//   eta/src/      the kernel (eta's src/, without its tests): the app imports it as `eta/<module>`
//   eta/model/    the model's page (eta's examples/modeling, without its tests)
//   eta/docs/     what a project keeps of eta's docs
//   eta/CHANGELOG.md, eta/VERSION, eta/update.ts, eta/package.json (a Bun workspace named eta)

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Of eta's docs, what a project keeps: what stories are for, the bento, and the eta-app skill's notes. */
export const DOCS_KEPT = ["stories.md", "bento", "eta-app-notes.md"];

/** What the kernel imports, so the project's root names it at eta's versions too. */
const KERNEL_DEPENDENCIES = ["@blueshed/delta", "@blueshed/railroad"];

/** eta's own skills, and those from the packages that ship them. */
const OWN_SKILLS = ["eta-app", "modelling"];
const PACKAGE_SKILLS = [
  ["@blueshed/railroad", "railroad"],
  ["@blueshed/delta", "delta-doc"],
] as const;

/** The scripts a project's root runs eta by. eta:update sets these again; a project's own are kept. */
export const SCRIPTS: Record<string, string> = {
  dev: "ETA_EXAMPLE=./src bun --watch eta/src/start.ts",
  start: "NODE_ENV=production ETA_EXAMPLE=./src bun eta/src/start.ts",
  test: "bun test",
  check: "bun check",
  stories: "ETA_EXAMPLE=./src bun --env-file=.env.test eta/src/stories-run.ts",
  "stories:hand": "STORY_BY_HAND=1 ETA_EXAMPLE=./src bun --env-file=.env.test eta/src/stories-run.ts",
  cli: "ETA_EXAMPLE=./src bun eta/src/cli.ts",
  model: "ETA_EXAMPLE=./eta/model DB_PATH=${MODEL_DB:-model.sqlite} PORT=${MODEL_PORT:-3001} bun --watch eta/src/start.ts",
  "cli:model": "ETA_EXAMPLE=./eta/model ETA_URL=ws://localhost:${MODEL_PORT:-3001} bun eta/src/cli.ts",
  "model:check": "ETA_URL=ws://localhost:${MODEL_PORT:-3001} LOG_LEVEL=warn bun --env-file=.env.test eta/model/loader/check.ts ./src",
  "model:load": "ETA_URL=ws://localhost:${MODEL_PORT:-3001} LOG_LEVEL=warn bun --env-file=.env.test eta/model/loader/load.ts ./src",
  "eta:update": "bun eta/update.ts",
};

export const BUNFIG = `[test]
# coverage is always on, and 100% is a gate: the run fails below it. It covers the app (src/):
# eta/ is eta's, tested in eta itself.
coverage = true
coverageThreshold = 1.0
coveragePathIgnorePatterns = ["**/node_modules/**", "eta/**", "src/stories.ts"]
`;

export const TSCONFIG_INCLUDE = '"include": ["src", "migrations", "eta"]';

export const MIGRATIONS_README = `A field renamed or dropped, or data moved, is a migration here, one file each; never edit one that has run. delta's migrate runs them.\n`;

type Pkg = { name?: string; version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; packageManager?: string; engines?: Record<string, string>; [key: string]: unknown };

/** Every file under `dir`, relative to it; never a dependency, a database or a Mac's litter. */
function filesIn(dir: string, at = ""): string[] {
  return readdirSync(join(dir, at)).flatMap((f) => {
    if (f === "node_modules" || f === ".DS_Store" || /\.sqlite(-shm|-wal)?$/.test(f)) return [];
    const path = at ? `${at}/${f}` : f;
    return statSync(join(dir, path)).isDirectory() ? filesIn(dir, path) : [path];
  });
}

function copy(from: string, to: string, keep: (path: string) => boolean = () => true): void {
  for (const path of filesIn(from).filter(keep)) {
    mkdirSync(dirname(join(to, path)), { recursive: true });
    cpSync(join(from, path), join(to, path));
  }
}

async function rewrite(path: string, fn: (text: string) => string): Promise<void> {
  const file = Bun.file(path);
  await Bun.write(file, fn(await file.text()));
}

const code = (path: string) => /\.(ts|tsx|css|html)$/.test(path);
const isTest = (path: string) => /\.test\.|\.test-|test\.fixture/.test(path);

/**
 * Each import of eta's kernel in `dir`, a path `up` folders above it into `src/` (`../../src/bento`
 * in eta's examples, `../src/bento` in a project's old `app/`), made an import of the package by
 * name: `eta/bento`, and `@import "eta/bento.css"`.
 */
export async function importEta(dir: string, up: number): Promise<void> {
  for (const path of filesIn(dir).filter(code)) {
    const depth = path.split("/").length - 1;
    await rewrite(join(dir, path), (text) => text.replaceAll(new RegExp(`(["'])${"\\.\\./".repeat(depth + up)}src/`, "g"), "$1eta/"));
  }
}

/** A folder moved one level up within eta: its relative imports of `src/` lose one `../` at each depth. */
async function lift(dir: string): Promise<void> {
  for (const path of filesIn(dir).filter(code)) {
    const depth = path.split("/").length - 1;
    await rewrite(join(dir, path), (text) => text.replaceAll(new RegExp(`(["'])${"\\.\\./".repeat(depth + 2)}src/`, "g"), `$1${"../".repeat(depth + 1)}src/`));
  }
}

/** The version an eta checkout is: its package.json's, and `+unreleased` when its changelog has more under [Unreleased]. */
export async function versionOf(checkout: string): Promise<string> {
  const { version } = (await Bun.file(join(checkout, "package.json")).json()) as Pkg;
  const unreleased = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/.exec(await Bun.file(join(checkout, "CHANGELOG.md")).text())?.[1]?.trim() ?? "";
  return unreleased ? `${version}+unreleased` : version;
}

/** Makes `dest` (a project's eta/) from an eta checkout, replacing whatever was there whole. Answers its version. */
export async function makeEta(checkout: string, dest: string): Promise<string> {
  const pkg = (await Bun.file(join(checkout, "package.json")).json()) as Pkg;
  const version = await versionOf(checkout);
  const next = `${dest}.next`;
  rmSync(next, { recursive: true, force: true });
  copy(join(checkout, "src"), join(next, "src"), (f) => !isTest(f));
  copy(join(checkout, "examples/modeling"), join(next, "model"), (f) => !isTest(f) && !f.startsWith("loader/londons/"));
  await lift(join(next, "model"));
  for (const doc of DOCS_KEPT) cpSync(join(checkout, "docs", doc), join(next, "docs", doc), { recursive: true });
  cpSync(join(checkout, "CHANGELOG.md"), join(next, "CHANGELOG.md"));
  cpSync(join(checkout, "create/update.ts"), join(next, "update.ts"));
  await Bun.write(join(next, "VERSION"), `${version}\n`);
  await Bun.write(
    join(next, "README.md"),
    `# eta ${version}\n\nThe kernel (\`src/\`), the model's page (\`model/\`) and the docs a project keeps. Never edited here: a change the\nkernel needs is eta's (https://github.com/blueshed/eta). \`bun run eta:update\` replaces this folder whole with a later eta.\n`,
  );
  const dependencies = Object.fromEntries(KERNEL_DEPENDENCIES.map((d) => [d, pkg.dependencies![d]!]));
  const etaPkg = { name: "eta", version, private: true, type: "module", exports: { "./bento.css": "./src/bento.css", "./*": "./src/*.ts" }, dependencies };
  await Bun.write(join(next, "package.json"), JSON.stringify(etaPkg, null, 2) + "\n");
  rmSync(dest, { recursive: true, force: true });
  renameSync(next, dest);
  return version;
}

/** A project's package.json, following eta's: its workspace, eta's scripts, the kernel's dependencies at eta's versions, eta's Bun. */
export function projectPackage(pkg: Pkg, eta: Pkg): Pkg {
  const kernel = Object.fromEntries(KERNEL_DEPENDENCIES.map((d) => [d, eta.dependencies![d]!]));
  const { scripts, dependencies, devDependencies, ...rest } = pkg;
  return {
    ...rest,
    packageManager: eta.packageManager,
    engines: eta.engines,
    workspaces: ["eta"],
    scripts: { ...scripts, ...SCRIPTS },
    dependencies: { ...dependencies, ...kernel, eta: "workspace:*" },
    devDependencies,
  };
}

/** The skills, fresh: eta's own from the checkout, delta's and railroad's from node_modules (after `bun install`). */
export function refreshSkills(checkout: string, root: string): string[] {
  const missing: string[] = [];
  const skills = join(root, ".claude/skills");
  if (resolve(checkout) !== resolve(root)) {
    for (const skill of OWN_SKILLS) {
      rmSync(join(skills, skill), { recursive: true, force: true });
      cpSync(join(checkout, ".claude/skills", skill), join(skills, skill), { recursive: true });
    }
  }
  for (const [pkg, skill] of PACKAGE_SKILLS) {
    const from = join(root, `node_modules/${pkg}/.claude/skills/${skill}`);
    if (!existsSync(from)) {
      missing.push(`${pkg}'s ${skill} skill not found: after \`bun install\`, copy node_modules/${pkg}/.claude/skills/${skill} into .claude/skills`);
      continue;
    }
    rmSync(join(skills, skill), { recursive: true, force: true });
    cpSync(from, join(skills, skill), { recursive: true });
  }
  return missing;
}

export const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The project's CLAUDE.md: what is here, and the rules. */
export const claude = (Name: string) => `# CLAUDE.md

${Name}: an app on eta, told before it is built.

## What is here

- \`src/\`: the app (\`bun dev\`, port 3000), built from the model. Load the **eta-app** skill before
  any change to it: it says which short file to read for each step. It imports eta by name
  (\`from "eta/stories"\`, \`@import "eta/bento.css"\`), never by a path into \`eta/\`.
- \`migrations/\`: a field renamed or dropped, or data moved, is a migration here; never edit one
  that has run.
- \`eta/\`: eta, never edited: its kernel (\`eta/src/\`, whose types are the contract), the model's
  page (\`eta/model/\`), the docs a project keeps (\`eta/docs/\`), its changelog and its version
  (\`eta/VERSION\`). A change the kernel needs is eta's, made there and released.
  \`bun run eta:update [version]\` replaces \`eta/\` whole with a later eta (the latest release by
  default), refreshes the skills, prints what eta's changelog says changed since, what to change
  first, and runs the gate. It commits nothing: carry across what it says, then commit.
- The model's page (\`bun run model\`, port 3001). You tell the stories; Claude writes them down and
  describes the documents they need with \`bun run cli:model\`, and the page shows each change as
  it lands. Only while someone is telling you the stories: then load the **modelling** skill and
  write them there as they are told.

## Working here

- Bun only: never \`node\`, \`npm\`, \`yarn\` or \`python\`; a script or an edit is \`bun -e\` or a file.
- Asked to build or change something: build it. Its stories go in \`src/stories.ts\` first, then the
  least that makes them pass; build nothing no story needs.
- Never stop to wait for an answer. A question goes in \`todo.jsonl\` with the reading you took, and
  the work goes on.
- The gate before a commit: \`bun check\`, \`bun test\` (100% coverage of \`src/\`), \`bun run stories\`.
- \`todo.jsonl\` is what is open; \`CHANGELOG.md\` is where the app has been. They move together.
- No new dependencies without asking.
- A Claude Code web session is made ready by \`.claude/hooks/session-start.sh\`: Bun up to
  \`engines.bun\`, and Chromium once a test uses \`Bun.WebView\` (\`--dry-run\` says what it would do).

## The wire

- HTML is the only vocabulary; the server is the only renderer.
- A write names a document and a JSON Pointer path, never a function name.
- A page is told only what it read, and sent only the parts that changed.
`;

// ---- eta:update ----

/** A project made before eta/ was: the app in app/, eta's kernel in src/, the model's page in model/. */
const isOldLayout = (root: string) => !existsSync(join(root, "eta/VERSION")) && existsSync(join(root, "app")) && existsSync(join(root, "src/server.ts")) && existsSync(join(root, "model"));

/** The eta a project is on: eta/VERSION, or, before eta/ was, the version its changelog says it started from. */
async function projectVersion(root: string): Promise<string | null> {
  if (existsSync(join(root, "eta/VERSION"))) return (await Bun.file(join(root, "eta/VERSION")).text()).trim();
  const changelog = await Bun.file(join(root, "CHANGELOG.md")).text().catch(() => "");
  return /Started from \[eta\]\([^)]*\) (\d+\.\d+\.\d+)/.exec(changelog)?.[1] ?? null;
}

/** Moves a project of app/, model/ and src/ to this layout, once: the app to src/, importing eta by name; eta's three folders go (eta/ follows). */
async function moveOldLayout(root: string): Promise<string[]> {
  const pkg = (await Bun.file(join(root, "package.json")).json()) as Pkg;
  rmSync(join(root, "src"), { recursive: true }); // eta's kernel, never edited: eta/src/ replaces it
  rmSync(join(root, "model"), { recursive: true }); // the model's page: eta/model/
  for (const doc of DOCS_KEPT) rmSync(join(root, "docs", doc), { recursive: true, force: true }); // eta/docs/
  if (existsSync(join(root, "docs")) && readdirSync(join(root, "docs")).length === 0) rmSync(join(root, "docs"), { recursive: true });
  renameSync(join(root, "app"), join(root, "src"));
  await importEta(join(root, "src"), 1);
  mkdirSync(join(root, "migrations"), { recursive: true });
  if (!existsSync(join(root, "migrations/README.md"))) await Bun.write(join(root, "migrations/README.md"), MIGRATIONS_README);
  await rewrite(join(root, "tsconfig.json"), (t) => t.replace(/"include": \[[^\]]*\]/, TSCONFIG_INCLUDE));
  await rewrite(join(root, "bunfig.toml"), (t) =>
    t.replace(/coveragePathIgnorePatterns = \[([^\]]*)\]/, (_, list: string) => {
      const patterns = list.split(",").map((p) => p.trim()).filter((p) => p && p !== '"src/**"' && p !== '"model/**"').map((p) => p.replace(/^"app\//, '"src/'));
      return `coveragePathIgnorePatterns = [${[...new Set(['"**/node_modules/**"', '"eta/**"', ...patterns])].join(", ")}]`;
    }).replaceAll("(app/)", "(src/)").replace(/src\/ is eta's kernel and model\/ eta's modeling page, each tested in eta itself\./, "eta/ is eta's, tested in eta itself."),
  );
  await Bun.write(join(root, "CLAUDE.md"), claude(title(pkg.name ?? "app")));
  return [
    "Moved this project to eta's layout, once: app/ is src/, importing eta by name (`eta/stories`, `eta/bento.css`); src/ and model/ (eta's kernel and model page) and eta's docs are gone, replaced by eta/; migrations/ is new.",
    "CLAUDE.md is eta's template again, saying what is here now: `git diff CLAUDE.md` for any lines of your own to carry back.",
  ];
}

const semver = (v: string) => v.split("+")[0]!;

/** The bullets of eta's changelog after `from`, up to `to`: what to change first, then the rest, each with its version. */
export function changesBetween(changelog: string, from: string | null, to: string): { change: string[]; rest: string[] } {
  const change: string[] = [];
  const rest: string[] = [];
  for (const section of changelog.split(/\n(?=## \[)/).slice(1)) {
    const at = /^## \[([^\]]+)\]/.exec(section)![1]!;
    if (at === "Unreleased" ? !to.includes("+") : (from && Bun.semver.order(at, semver(from)) <= 0) || Bun.semver.order(at, semver(to)) > 0) continue;
    for (const item of section.split(/\n(?=- )/).slice(1)) {
      const text = `[${at}] ${item.replace(/\n(###|##)[\s\S]*$/, "").trim().slice(2)}`;
      (/What to change/.test(item) ? change : rest).push(text);
    }
  }
  return { change, rest };
}

/** The project's gate, as its builder runs it: each step, passed or what it said. */
function gate(root: string): boolean {
  let ok = true;
  for (const cmd of [["bun", "check"], ["bun", "test"], ["bun", "run", "stories"]]) {
    const run = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const name = cmd.join(" ");
    if (run.exitCode === 0) console.log(`  ${name}: passed`);
    else {
      ok = false;
      const out = (run.stdout.toString() + run.stderr.toString()).trim().split("\n").slice(-40).join("\n    ");
      console.log(`  ${name}: FAILED\n    ${out}`);
    }
  }
  return ok;
}

/**
 * Brings the project at `root` to the eta at `checkout`: moves an old layout once; replaces eta/
 * whole; sets the root's eta scripts and the kernel's dependencies; installs; refreshes the
 * skills; notes it in the project's changelog; prints what eta's changelog says changed since
 * (what to change first); runs the gate. Commits nothing. Answers whether the gate passed.
 */
export async function update(root: string, checkout: string): Promise<boolean> {
  if (existsSync(join(root, "create/setup.ts"))) throw new Error(`${root} is eta itself: eta:update is run in a project made from it`);
  const old = isOldLayout(root);
  if (!old && !existsSync(join(root, "eta/VERSION"))) throw new Error(`${root} has no eta/VERSION, and is not a project of app/, model/ and src/: run eta:update at a project's root`);
  const from = await projectVersion(root);
  const notes = old ? await moveOldLayout(root) : [];
  const to = await makeEta(checkout, join(root, "eta"));
  const eta = (await Bun.file(join(checkout, "package.json")).json()) as Pkg;
  const pkg = (await Bun.file(join(root, "package.json")).json()) as Pkg;
  await Bun.write(join(root, "package.json"), JSON.stringify(projectPackage(pkg, eta), null, 2) + "\n");
  const install = Bun.spawnSync(["bun", "install"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode !== 0) notes.push(`bun install failed:\n${install.stderr.toString().trim()}`);
  notes.push(...refreshSkills(checkout, root));
  await rewrite(join(root, "CHANGELOG.md"), (t) => t.replace(/## \[Unreleased\]\n\n?/, (h) => `${h}- On [eta](https://github.com/blueshed/eta) ${to}${from ? `, from ${from}` : ""} (\`bun run eta:update\`).\n`));

  console.log(`\neta ${from ?? "(unknown)"} -> ${to}: eta/ replaced whole; package.json's eta scripts and the kernel's dependencies set; the eta-app, modelling, delta-doc and railroad skills refreshed.\n`);
  for (const note of notes) console.log(`${note}\n`);
  const { change, rest } = changesBetween(await Bun.file(join(root, "eta/CHANGELOG.md")).text(), from, to);
  if (from === null) console.log("Which eta this project was on is not known: read eta/CHANGELOG.md for what changed.\n");
  else if (change.length + rest.length === 0) console.log("eta's changelog says nothing changed since.\n");
  else {
    console.log(`What to change (eta's changelog, after ${from}):\n`);
    console.log(change.length ? change.map((c) => `- ${c}`).join("\n\n") : "- nothing");
    if (rest.length) console.log(`\nWhat else changed:\n\n${rest.map((c) => `- ${c}`).join("\n\n")}`);
    console.log();
  }
  console.log("The gate:");
  const ok = gate(root);
  console.log(`\n${ok ? "The gate passes." : "The gate fails: carry across what eta's changelog says to change, above, until it passes."} Nothing is committed: \`git status\` says what changed.`);
  return ok;
}
