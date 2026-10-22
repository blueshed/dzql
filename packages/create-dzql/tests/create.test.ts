import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fresh app from `bun create dzql`, made as npm would run it, its packages the workspace's own
// (the root's node_modules, linked in: dzql and delta as they are here, not as npm last had them).
const root = join(import.meta.dir, "../../..");
const parent = mkdtempSync(join(tmpdir(), "create-dzql-"));
const app = join(parent, "my-app");

beforeAll(async () => {
  const made = Bun.spawnSync(["bun", join(import.meta.dir, "../cli.ts"), "my-app", "--no-install", "--no-git"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.stderr.toString()).toBe("");
  expect(made.exitCode).toBe(0);
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"));
});
afterAll(() => rmSync(parent, { recursive: true, force: true }));

test("the app is the template, laid out as it is, named, its dotfiles dotted", () => {
  for (const file of ["src/routes.ts", "stories.ts", "tests/routes.test.ts", "src/page.ts", "src/index.html", ".gitignore", ".env.test", "README.md", "CLAUDE.md", "CHANGELOG.md", "todo.jsonl", ".github/workflows/ci.yml", "Dockerfile", ".dockerignore"]) expect(existsSync(join(app, file))).toBe(true);
  expect(existsSync(join(app, "src/stories.ts")) || existsSync(join(app, "src/routes.test.ts"))).toBe(false); // laid out as a paintbrush app
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  expect(pkg.name).toBe("my-app"); // the template's own, dzql-starter, is the workspace's
  expect(pkg.scripts.prepare).toBe("delta install-skills"); // the skills on every install: the app's, never the template's
  expect(readFileSync(join(app, "CHANGELOG.md"), "utf8")).toContain(`- Started from create-dzql ${require("../package.json").version}.`);
  expect(readFileSync(join(app, "src/routes.ts"), "utf8")).toContain('name: "my-app"');
  expect(readFileSync(join(app, "src/page.ts"), "utf8")).toContain("My App");
  expect(readFileSync(join(app, "src/styles.css"), "utf8")).toContain('@import "dzql/rendering/bento-plain.css";');
  expect(readFileSync(join(app, "README.md"), "utf8")).toStartWith("# My App\n");
  // the tests never touch the database `bun dev` keeps, and neither is committed (cafe-e's feedback)
  expect(readFileSync(join(app, ".env.test"), "utf8")).toContain("DB_PATH=:memory:");
  expect(readFileSync(join(app, ".gitignore"), "utf8")).toContain("db.sqlite*");
});

test("installing gives the app its skills: dzql-app, modelling and delta-doc", () => {
  const installed = Bun.spawnSync(["bun", "run", "prepare"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  expect(installed.exitCode).toBe(0);
  for (const skill of ["dzql-app", "modelling", "delta-doc"]) expect(existsSync(join(app, ".claude/skills", skill, "SKILL.md"))).toBe(true);
});

test("the model's page starts beside the app, from dzql's modeling example", async () => {
  const proc = Bun.spawn(["bun", "run", "model"], { cwd: app, stdout: "pipe", stderr: "inherit", env: { ...process.env, MODEL_PORT: "0" } });
  try {
    let out = "";
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/Listening on \S+/.test(out)) break;
    }
    const url = out.match(/Listening on (\S+)/)![1]!;
    expect((await fetch(url)).status).toBe(200);
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 30_000);

test("its Dockerfile runs on the Bun its package.json names, which is the workspace's", () => {
  const from = /^FROM oven\/bun:(\d+\.\d+\.\d+)(-\w+)?$/m.exec(readFileSync(join(app, "Dockerfile"), "utf8"))?.[1];
  expect(`bun@${from}`).toBe(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).packageManager);
  expect(`bun@${from}`).toBe(require("../../../package.json").packageManager);
  expect(readFileSync(join(app, ".dockerignore"), "utf8")).toContain(".env\n"); // no secret goes into the image
});

test("its scripts run dzql through its bin, never a file of dzql's own: the stories are told", () => {
  const { scripts } = JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const [name, line] of Object.entries(scripts)) expect(`${name}: ${line}`).not.toContain("node_modules/");
  const told = Bun.spawnSync(["bun", "run", "stories"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  expect(told.stdout.toString()).toContain("0 passed, 0 failed");
  expect(told.exitCode).toBe(0);
  const read = Bun.spawnSync(["bun", "run", "model:check"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  expect(read.stdout.toString()).toContain("hjeli's predicates");
  expect(read.exitCode).toBe(0);
}, 30_000);

test("a name that is not one is refused", () => {
  const made = Bun.spawnSync(["bun", join(import.meta.dir, "../cli.ts"), "My App"], { cwd: parent, stderr: "pipe" });
  expect(made.exitCode).toBe(1);
  expect(made.stderr.toString()).toContain("is not a name for an app");
});

test("it type-checks, and its own tests pass", () => {
  const checked = Bun.spawnSync(["bun", "check"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  expect(checked.stdout.toString() + checked.stderr.toString()).toContain("No type errors");
  expect(checked.exitCode).toBe(0);
  const tested = Bun.spawnSync(["bun", "test"], { cwd: app, stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "test" } });
  expect(tested.stderr.toString()).toContain(" 0 fail");
  expect(tested.exitCode).toBe(0);
}, 60_000);

test("it starts on delta's one server: the page, drawn over the socket, and /health; in production over a pid file a container left", async () => {
  // a pid file naming a live process not the server's, as a container restarted can leave (its pid reused): production starts all the same
  writeFileSync(join(app, ".server.pid"), String(process.pid));
  // a production start with no DATABASE_URL: PGlite, said to be meant (dzql's openStore refuses it unsaid)
  const proc = Bun.spawn(["bun", "run", "start"], { cwd: app, stdout: "pipe", stderr: "inherit", env: { ...process.env, PORT: "0", DZQL_PGLITE_IN_PRODUCTION: "1" } });
  try {
    let out = "";
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/Listening on \S+/.test(out)) break;
    }
    const url = out.match(/Listening on (\S+)/)![1]!;
    expect((await fetch(new URL("/health", url))).status).toBe(200);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>My App</title>");
    const ws = new WebSocket(Object.assign(new URL("/ws", url), { protocol: "ws:" }));
    const html = await new Promise<string>((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data)).html)));
    expect(html).toContain("Tell the first story");
    ws.close();
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 30_000);

// The first commit, as create-blueshed makes it; none without git, or inside a repository already
test("the app is its own repository, one clean first commit; none without git, or inside another repository", () => {
  const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", "-c", "user.email=t@example.com", "-c", "user.name=t", ...a], { cwd, stdout: "pipe" }).stdout.toString().trim();
  const make = (cwd: string, name: string, env: Record<string, string | undefined> = process.env) =>
    Bun.spawnSync([process.execPath, join(import.meta.dir, "../cli.ts"), name, "--no-install"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  expect(make(parent, "own").exitCode).toBe(0);
  expect(git(join(parent, "own"), "log", "--format=%s")).toBe("Initial commit");
  expect(git(join(parent, "own"), "status", "--porcelain")).toBe("");
  const repo = join(parent, "mono");
  Bun.spawnSync(["mkdir", "-p", repo]);
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  const inner = make(repo, "inner");
  expect(inner.stdout.toString()).toContain("already inside a git repository: no repository of its own");
  expect(existsSync(join(repo, "inner/.git"))).toBe(false);
  const bare = make(parent, "bare", { ...process.env, PATH: "/nonexistent" });
  expect(bare.stderr.toString()).toBe("");
  expect(bare.stdout.toString()).toContain("git not found: no repository made");
  expect(existsSync(join(parent, "bare/.git"))).toBe(false);
});

