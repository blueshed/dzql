import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELETED, NAMED, readme, setup } from "../create/setup";

// A scratch "template" folder named like an app, with just enough of the template in it
async function scratchTemplate(files: Record<string, string>) {
  const parent = mkdtempSync(`${tmpdir()}/setup-`);
  const root = join(parent, "my-app");
  mkdirSync(root);
  for (const [path, text] of Object.entries(files)) await Bun.write(join(root, path), text);
  return { root, done: () => rmSync(parent, { recursive: true, force: true }) };
}

test("setup turns the template into an app", async () => {
  const { root, done } = await scratchTemplate({
    "todo.jsonl": '{"n": 1}\n',
    gitignore: "data/\n",
    "CHANGELOG.md": "# the template's changelog\n",
    "logo.png": "the template's logo",
    "create/setup.ts": "// this script",
    "tests/setup.test.ts": "// this script's test",
    "tests/evolve.ts": "// the evolve skill's test",
    "evals/evolve.json": "[]",
    ".github/workflows/ci.yml": "      - run: bun test\n\n      # The evolve skill's sections, each applied to a new app and run.\n      # setup deletes this step.\n      - run: bun run test:evolve\n",
    "src/index.html": "<title>Paintbrush</title>",
    "package.json": '{\n  "name": "paintbrush",\n  "version": "0.5.0",\n  "private": true,\n  "scripts": {\n    "test": "bun run test:fast",\n    "test:evolve": "bun test ./tests/evolve.ts",\n    "start": "bun src/routes.ts",\n    "test:fast": "bun check && bun test",\n    "test:slow": "bun run test:evolve"\n  }\n}\n',
    "CLAUDE.md": "# Paintbrush\n<!-- template -->\nNotes on developing the template.\n<!-- /template -->\nAbout the app.\n",
    ".claude/launch.json": '{ "name": "paintbrush" }',
    ".railway/railway.ts": 'project("paintbrush", {})',
  });
  // delta, as bun install leaves it: setup runs its install-skills, which finds railroad's skills beside it
  mkdirSync(join(root, "node_modules/@blueshed"), { recursive: true });
  symlinkSync(join(import.meta.dir, "../../delta"), join(root, "node_modules/@blueshed/delta"));
  mkdirSync(join(root, "node_modules/.bin"));
  symlinkSync("../@blueshed/delta/src/cli.ts", join(root, "node_modules/.bin/delta")); // its bin, as bun install links it
  try {
    await setup(root);

    expect(await Bun.file(join(root, "todo.jsonl")).text()).toBe(""); // a fresh ledger
    expect(await Bun.file(join(root, ".gitignore")).text()).toBe("data/\n"); // npm's way round: the template's gitignore, dotted
    expect(existsSync(join(root, "gitignore"))).toBe(false);
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain("## [Unreleased]");
    // the template's version, so the app knows which of the template's changes it has
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain("- Started from [paintbrush](https://github.com/blueshed/dzql/tree/main/packages/paintbrush) 0.5.0. To bring this app up to date,");
    // what is about the template goes: its logo, this script and its test, the skill's test and evals
    for (const path of ["logo.png", "create/setup.ts", "tests/setup.test.ts", "tests/evolve.ts", "evals/evolve.json"]) {
      expect(await Bun.file(join(root, path)).exists()).toBe(false);
    }
    expect(await Bun.file(join(root, "README.md")).text()).toContain("# my-app");
    // the app's name and own version, and only the app's scripts: the template's tiers and the evolve skill's test go
    expect(await Bun.file(join(root, "package.json")).text()).toBe('{\n  "name": "my-app",\n  "version": "0.0.0",\n  "private": true,\n  "scripts": {\n    "test": "bun check && bun test",\n    "start": "bun src/routes.ts"\n  }\n}\n');
    expect(await Bun.file(join(root, ".github/workflows/ci.yml")).text()).toBe("      - run: bun test\n"); // no step for the evolve test
    expect(await Bun.file(join(root, "src/index.html")).text()).toBe("<title>my-app</title>");
    expect(await Bun.file(join(root, ".claude/launch.json")).text()).toBe('{ "name": "my-app" }');
    expect(await Bun.file(join(root, ".railway/railway.ts")).text()).toBe('project("my-app", {})');
    expect(await Bun.file(join(root, "CLAUDE.md")).text()).toBe("# my-app\nAbout the app.\n");
    expect(await Bun.file(join(root, ".claude/skills/railroad/SKILL.md")).text()).toContain("name: railroad");
    expect(await Bun.file(join(root, ".claude/skills/delta-doc/SKILL.md")).text()).toContain("name: delta-doc");
    expect(existsSync(join(root, ".claude/skills/bun-route"))).toBe(false); // it contradicts CLAUDE.md
  } finally {
    done();
  }
});

test("run as a script, the way bun create runs it, setup works on the current folder", async () => {
  const { root, done } = await scratchTemplate({
    "todo.jsonl": '{"n": 1}\n',
    gitignore: "data/\n",
    "src/index.html": "<title>Paintbrush</title>",
  });
  try {
    const proc = Bun.spawn([process.execPath, `${import.meta.dir}/../create/setup.ts`], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(await proc.exited).toBe(0);
    expect(err).not.toContain("Error");
    expect(out).toContain("Setting up my-app...");
    expect(await Bun.file(join(root, "src/index.html")).text()).toBe("<title>my-app</title>");
    expect(await Bun.file(join(root, "todo.jsonl")).text()).toBe("");
  } finally {
    done();
  }
});

test("setup refuses to run in a clone of the template, and touches nothing", async () => {
  const { root, done } = await scratchTemplate({ "todo.jsonl": '{"n": 1}\n', "create/setup.ts": "// this script" });
  try {
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/blueshed/paintbrush.git"], { cwd: root });

    await expect(setup(root)).rejects.toThrow("clone of the paintbrush template");
    expect(await Bun.file(join(root, "todo.jsonl")).text()).toBe('{"n": 1}\n');
    expect(await Bun.file(join(root, "create/setup.ts")).exists()).toBe(true);
  } finally {
    done();
  }
});

test("setup says so when the skills are not installed (no delta yet), and skips files that are not there", async () => {
  const { root, done } = await scratchTemplate({});
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args) => void warnings.push(args.join(" "));
  try {
    await setup(root);
    expect(warnings.join("\n")).toContain("the skills are not installed: after `bun install`, run `bunx delta install-skills --skip bun-route,dzql-app`");
    expect(existsSync(join(root, ".claude/skills"))).toBe(false);
  } finally {
    console.warn = warn;
    done();
  }
});

test("every file setup renames exists, and the template's name is nowhere else", async () => {
  const root = `${import.meta.dir}/..`;
  for (const path of NAMED) expect(await Bun.file(`${root}/${path}`).exists()).toBe(true);

  // Files that may say "paintbrush": the ones setup renames, replaces or deletes (a deleted folder whole), and package.json (setup names the app in it)
  const allowed = new Set([...NAMED, "README.md", "package.json"]);
  const deleted = (path: string) => DELETED.some((d) => path === d || path.startsWith(`${d}/`));
  const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }).stdout.toString();
  const strays: string[] = [];
  for (const path of listed.split("\n").filter((p) => p && !p.endsWith(".png") && !allowed.has(p) && !deleted(p))) {
    if (!existsSync(`${root}/${path}`)) continue; // listed, then deleted
    if (/paintbrush/i.test(await Bun.file(`${root}/${path}`).text())) strays.push(path);
  }
  expect(strays).toEqual([]);
});

// --- The first commit: setup's last step ---

const git = (root: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString().trim();

// A scratch app folder that is a git repository, with a commit of the given subject if there is one
async function scratchRepo(commit?: string) {
  const scratch = await scratchTemplate({ "todo.jsonl": '{"n": 1}\n' });
  git(scratch.root, "init", "-q");
  git(scratch.root, "config", "user.name", "Test");
  git(scratch.root, "config", "user.email", "test@example.com");
  if (commit) {
    git(scratch.root, "add", "-A");
    git(scratch.root, "commit", "-q", "-m", commit);
  }
  return scratch;
}

test("a repository with no commit gets one, with everything in it", async () => {
  const { root, done } = await scratchRepo();
  try {
    await setup(root);
    expect(git(root, "log", "--format=%s")).toBe("Initial commit");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    done();
  }
});

test("somebody else's history is left alone", async () => {
  const { root, done } = await scratchRepo("Add things");
  try {
    await setup(root);
    expect(git(root, "log", "--format=%s")).toBe("Add things");
    expect(git(root, "status", "--porcelain")).not.toBe(""); // setup's changes are not committed
  } finally {
    done();
  }
});

// The README a new app opens with shows what you write: each of its TypeScript blocks names a file on
// its first line, and every line after it is a line of that file, so the README cannot drift from the code
test("the new app's README quotes its own files", async () => {
  const blocks = [...readme("my-app").matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(([, body]) => body!.trimEnd().split("\n"));
  expect(blocks.length).toBe(3);
  for (const [first, ...lines] of blocks) {
    const path = first!.match(/^\/\/ ([\w./-]+)$/)![1]!;
    const file = (await Bun.file(join(import.meta.dir, "..", path)).text()).split("\n");
    for (const line of lines) expect(file).toContain(line);
  }
});

test("with no git on the PATH, setup still makes the app: no clone to refuse, no commit to make", async () => {
  const { root, done } = await scratchTemplate({ "todo.jsonl": '{"n": 1}\n', "package.json": '{\n  "name": "paintbrush",\n  "version": "0.5.0"\n}\n' });
  try {
    // as a person runs it, in a process of its own: Bun's spawnSync throws on a program it cannot find
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "../create/setup.ts")], { cwd: root, env: { ...process.env, PATH: "/nonexistent" }, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(0);
    expect(await Bun.file(join(root, "todo.jsonl")).text()).toBe("");
    expect(existsSync(join(root, ".git"))).toBe(false);
  } finally {
    done();
  }
});
