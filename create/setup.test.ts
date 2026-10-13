import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// `bun create blueshed/eta garden`, as bun create does it, on a scratch copy of eta: the files git
// knows (tracked, or new and not ignored) copied into a folder named for the project, eta's
// node_modules where bun install would have put them, a git of its own, then the postinstall --
// and then the new project's own gate, and its model's page, served.

const eta = join(import.meta.dir, "..");
const parent = mkdtempSync(join(tmpdir(), "eta-create-"));
const root = join(parent, "garden");
const run = (cmd: string[], env: Record<string, string | undefined> = {}) => {
  const p = Bun.spawnSync(cmd, { cwd: root, env: { ...process.env, DB_PATH: undefined, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};

beforeAll(() => {
  const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd: eta }).stdout.toString().trim().split("\n");
  for (const f of files.filter((f) => existsSync(join(eta, f)))) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(eta, f), join(root, f));
  }
  symlinkSync(join(eta, "node_modules"), join(root, "node_modules"));
  for (const args of [["init", "-q"], ["config", "user.name", "Ada Lovelace"], ["config", "user.email", "ada@example.com"]]) run(["git", ...args]);
}, 60000);

afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe("bun create blueshed/eta garden", () => {
  test("setup makes a project of three folders: the app, the model's page, eta's kernel -- and nothing of eta's own", () => {
    const setup = run(["bun", "create/setup.ts"]);
    expect(setup.out).toContain("garden is ready!");
    expect(setup.code).toBe(0);
    for (const path of ["app/index.ts", "app/stories.ts", "model/index.ts", "model/cli.ts", "src/server.ts", ".claude/skills/eta-app/SKILL.md", ".claude/skills/modelling/SKILL.md", ".claude/skills/delta-doc", ".claude/skills/railroad"]) expect(existsSync(join(root, path))).toBe(true);
    for (const path of ["examples", "modeller", "history", "create", "first-app.md", "model/server.test.ts", "src/server.test.ts", "src/client/app.test.html", ".claude/commands/publish.md"]) expect(existsSync(join(root, path))).toBe(false);
  }, 60000);

  test("it is named for its folder, says which eta it started from, and keeps its model's password out of git", async () => {
    expect(await Bun.file(join(root, "app/page.ts")).text()).toContain('<h1 class="cap">Garden</h1>');
    expect((await Bun.file(join(root, "package.json")).json()).name).toBe("garden");
    const version = (await Bun.file(join(eta, "package.json")).json()).version;
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain(`Started from [eta](https://github.com/blueshed/eta) ${version}.`);
    expect(await Bun.file(join(root, ".env")).text()).toMatch(/MODEL_NAME=Garden\nMODEL_PEOPLE=Ada,Claude\nMODEL_PASSWORD=[\w-]{36}\n/);
    expect(run(["git", "log", "--format=%s"]).out.trim()).toBe("Initial commit (via bun create)");
    expect(run(["git", "status", "--porcelain"]).out).toBe("");
    expect(run(["git", "ls-files", ".env"]).out).toBe("");
    expect(run(["bun", "create/setup.ts"]).out).toContain("Module not found"); // the script went with eta's own
  });

  test("its gate passes: the type check, the app's tests at 100%, its stories", () => {
    for (const cmd of [["bun", "check"], ["bun", "test"], ["bun", "run", "stories"]]) {
      const { code, out } = run(cmd);
      expect({ cmd: cmd.join(" "), code, out: code === 0 ? "" : out }).toEqual({ cmd: cmd.join(" "), code: 0, out: "" });
    }
  }, 120000);

  test("its model's page is its own model, empty, and its people sign in with the password in .env", async () => {
    const env = Object.fromEntries((await Bun.file(join(root, ".env")).text()).split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => l.split("=") as [string, string]));
    const port = String(41000 + Math.floor(Math.random() * 1000));
    const server = Bun.spawn(["bun", "src/start.ts"], { cwd: root, env: { ...process.env, ...env, ETA_EXAMPLE: "./model", PORT: port, DB_PATH: ":memory:" }, stdout: "pipe", stderr: "pipe" });
    try {
      const url = `http://localhost:${port}`;
      for (let i = 0; i < 50 && !(await fetch(url).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(100);
      const res = await fetch(`${url}/login`, { method: "POST", body: new URLSearchParams({ email: "ada@modeling.example", password: env.MODEL_PASSWORD! }), redirect: "manual", headers: { origin: url } });
      const session = /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
      expect(session).toBeString();
      // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
      const ws: WebSocket = new WebSocket(`ws://localhost:${port}/ws`, { headers: { Cookie: `session_id=${session}` } });
      const page = await new Promise<string>((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data)).html)));
      ws.close();
      expect(page).toContain("<h1>Garden</h1>");
      expect(page).toContain("No stories yet.");
    } finally {
      server.kill();
    }
  }, 30000);
});
