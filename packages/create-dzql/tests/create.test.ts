import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fresh app from `bun create dzql`, made as npm would run it, its packages the workspace's own
// (the root's node_modules, linked in: dzql and delta as they are here, not as npm last had them).
const root = join(import.meta.dir, "../../..");
const parent = mkdtempSync(join(tmpdir(), "create-dzql-"));
const app = join(parent, "my-app");

beforeAll(async () => {
  const made = Bun.spawnSync(["bun", join(import.meta.dir, "../cli.ts"), "my-app"], { cwd: parent, stdout: "pipe", stderr: "pipe" });
  expect(made.stderr.toString()).toBe("");
  expect(made.exitCode).toBe(0);
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"));
});
afterAll(() => rmSync(parent, { recursive: true, force: true }));

test("the app is eta's starter in src/, named, its dotfiles dotted", () => {
  for (const file of ["src/routes.ts", "src/stories.ts", "src/page.ts", "src/index.html", ".gitignore", ".env.test", "README.md", "CLAUDE.md"]) expect(existsSync(join(app, file))).toBe(true);
  expect(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).name).toBe("my-app");
  expect(readFileSync(join(app, "src/routes.ts"), "utf8")).toContain('name: "my-app"');
  expect(readFileSync(join(app, "src/page.ts"), "utf8")).toContain("My App");
  expect(readFileSync(join(app, "src/styles.css"), "utf8")).toContain('@import "dzql/rendering/bento-plain.css";');
  expect(readFileSync(join(app, "README.md"), "utf8")).not.toContain("{{name}}");
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

test("it starts on delta's one server: the page, drawn over the socket, and /health", async () => {
  const proc = Bun.spawn(["bun", "run", "start"], { cwd: app, stdout: "pipe", stderr: "inherit", env: { ...process.env, PORT: "0" } });
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
