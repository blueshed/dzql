import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELETED, NAMED, setup } from "../create/setup";

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
    "CHANGELOG.md": "# the template's changelog\n",
    "logo.png": "the template's logo",
    "create/setup.ts": "// this script",
    "tests/setup.test.ts": "// this script's test",
    "tests/evolve.ts": "// the evolve skill's test",
    "evals/evolve.json": "[]",
    ".github/workflows/ci.yml": "      - run: bun test\n\n      # The evolve skill's sections, each applied to a new app and run.\n      # setup deletes this step.\n      - run: bun run test:evolve\n",
    "src/index.html": "<title>Paintbrush</title>",
    "package.json": '{\n  "name": "my-app",\n  "version": "0.5.0",\n  "private": true,\n  "scripts": {\n    "test": "bun test",\n    "test:evolve": "bun test ./tests/evolve.ts",\n    "start": "bun src/main.ts"\n  }\n}\n',
    "CLAUDE.md": "# Paintbrush\n<!-- template -->\nNotes on developing the template.\n<!-- /template -->\nAbout the app.\n",
    ".claude/launch.json": '{ "name": "paintbrush" }',
    ".railway/railway.ts": 'project("paintbrush", {})',
    "node_modules/@blueshed/railroad/.claude/skills/railroad/SKILL.md": "the railroad skill",
    "node_modules/@blueshed/railroad/.claude/skills/bun-route/SKILL.md": "the bun-route skill",
    "node_modules/@blueshed/delta/.claude/skills/delta-doc/SKILL.md": "the delta-doc skill",
  });
  try {
    await setup(root);

    expect(await Bun.file(join(root, "todo.jsonl")).text()).toBe(""); // a fresh ledger
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain("## [Unreleased]");
    // the template's version, so the app knows which of the template's changes it has
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain("- Started from [paintbrush](https://github.com/blueshed/paintbrush) 0.5.0. To bring this app up to date,");
    // what is about the template goes: its logo, this script and its test, the skill's test and evals
    for (const path of ["logo.png", "create/setup.ts", "tests/setup.test.ts", "tests/evolve.ts", "evals/evolve.json"]) {
      expect(await Bun.file(join(root, path)).exists()).toBe(false);
    }
    expect(await Bun.file(join(root, "README.md")).text()).toContain("# my-app");
    // the app's own version, and no script for the evolve skill's test; everything else in package.json as it was
    expect(await Bun.file(join(root, "package.json")).text()).toBe('{\n  "name": "my-app",\n  "version": "0.0.0",\n  "private": true,\n  "scripts": {\n    "test": "bun test",\n    "start": "bun src/main.ts"\n  }\n}\n');
    expect(await Bun.file(join(root, ".github/workflows/ci.yml")).text()).toBe("      - run: bun test\n"); // no step for the evolve test
    expect(await Bun.file(join(root, "src/index.html")).text()).toBe("<title>my-app</title>");
    expect(await Bun.file(join(root, ".claude/launch.json")).text()).toBe('{ "name": "my-app" }');
    expect(await Bun.file(join(root, ".railway/railway.ts")).text()).toBe('project("my-app", {})');
    expect(await Bun.file(join(root, "CLAUDE.md")).text()).toBe("# my-app\nAbout the app.\n");
    expect(await Bun.file(join(root, ".claude/skills/railroad/SKILL.md")).text()).toBe("the railroad skill");
    expect(await Bun.file(join(root, ".claude/skills/delta-doc/SKILL.md")).text()).toBe("the delta-doc skill");
    expect(existsSync(join(root, ".claude/skills/bun-route"))).toBe(false); // it contradicts CLAUDE.md
  } finally {
    done();
  }
});

test("run as a script, the way bun create runs it, setup works on the current folder", async () => {
  const { root, done } = await scratchTemplate({
    "todo.jsonl": '{"n": 1}\n',
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

test("setup says so when a skill is not installed, and skips files that are not there", async () => {
  const { root, done } = await scratchTemplate({});
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args) => void warnings.push(args.join(" "));
  try {
    await setup(root);
    expect(warnings.join("\n")).toContain("@blueshed/railroad's railroad skill not found");
    expect(warnings.join("\n")).toContain("@blueshed/delta's delta-doc skill not found");
    expect(existsSync(join(root, ".claude/skills"))).toBe(false);
  } finally {
    console.warn = warn;
    done();
  }
});

test("every file setup renames exists, and the template's name is nowhere else", async () => {
  const root = `${import.meta.dir}/..`;
  for (const path of NAMED) expect(await Bun.file(`${root}/${path}`).exists()).toBe(true);

  // Files that may say "paintbrush": the ones setup renames, replaces or deletes (a deleted folder whole), and package.json (bun create renames it)
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

// --- Leaving the repository committed, whatever bun create's own git step managed ---

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
    expect(git(root, "log", "--format=%s")).toBe("Initial commit (via bun create)");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    done();
  }
});

test("bun create's own commit is amended with what setup wrote after it", async () => {
  const { root, done } = await scratchRepo("Initial commit (via bun create)");
  try {
    await setup(root); // empties todo.jsonl, writes a README and a changelog: all after that commit
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(root, "log", "--format=%s")).toBe("Initial commit (via bun create)");
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

test("setup waits out a git lock, and commits once it clears", async () => {
  const { root, done } = await scratchRepo();
  try {
    await Bun.write(join(root, ".git/index.lock"), ""); // what bun create's own git step holds while it runs
    setTimeout(() => rmSync(join(root, ".git/index.lock")), 500);
    await setup(root);
    expect(git(root, "log", "--format=%s")).toBe("Initial commit (via bun create)");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    done();
  }
});
