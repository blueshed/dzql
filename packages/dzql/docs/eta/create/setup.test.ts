import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// `bun create blueshed/eta garden`, as bun create does it, on a scratch copy of eta: the files git
// knows (tracked, or new and not ignored) copied into a folder named for the project, a git of its
// own, then the postinstall (which installs, eta being a workspace of the project now) -- and then
// the new project's own gate, its model's page, served, and `bun run eta:update` from this eta.
// Last, a project made by the eta before eta/ was (v0.53.0's setup), moved by eta:update, once.

const eta = join(import.meta.dir, "..");
const parent = mkdtempSync(join(tmpdir(), "eta-create-"));
const root = join(parent, "garden");
const run = (cmd: string[], env: Record<string, string | undefined> = {}, cwd = root) => {
  const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, DB_PATH: undefined, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};
const git = (cwd: string) => {
  for (const args of [["init", "-q"], ["config", "user.name", "Ada Lovelace"], ["config", "user.email", "ada@example.com"]]) run(["git", ...args], {}, cwd);
};

/** Every file under `dir`, relative to it, but node_modules. */
const filesIn = (dir: string, at = ""): string[] =>
  readdirSync(join(dir, at)).flatMap((f) => (f === "node_modules" ? [] : statSync(join(dir, at, f)).isDirectory() ? filesIn(dir, join(at, f)) : [join(at, f)]));
const snapshot = async (dir: string) => Object.fromEntries(await Promise.all(filesIn(dir).map(async (f) => [f, await Bun.file(join(dir, f)).text()] as const)));

/** The version eta is: package.json's, and `+unreleased` when its changelog has more under [Unreleased]. */
const changelog = await Bun.file(join(eta, "CHANGELOG.md")).text();
const unreleased = changelog.split("## [Unreleased]")[1]!.split("\n## [")[0]!.trim() !== "";
const version = (await Bun.file(join(eta, "package.json")).json()).version as string;

beforeAll(() => {
  const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd: eta }).stdout.toString().trim().split("\n");
  for (const f of files.filter((f) => existsSync(join(eta, f)))) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(eta, f), join(root, f));
  }
  git(root);
}, 60000);

afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe("bun create blueshed/eta garden", () => {
  test("the root is the app: src/, migrations/, and eta/, the one folder of eta's -- and nothing else of eta's", () => {
    const setup = run(["bun", "create/setup.ts"]);
    expect(setup.out).toContain("garden is ready!");
    expect(setup.code).toBe(0);
    expect(readdirSync(root).sort()).toEqual([".claude", ".env", ".env.test", ".git", ".gitignore", "CHANGELOG.md", "CLAUDE.md", "README.md", "bun.lock", "bunfig.toml", "eta", "migrations", "node_modules", "package.json", "src", "todo.jsonl", "tsconfig.json"]);
    for (const path of ["src/index.ts", "src/stories.ts", "src/delta.ts", "src/page.ts", "src/client/main.ts", "migrations/README.md", "eta/src/server.ts", "eta/src/stories.ts", "eta/src/bento.css", "eta/model/index.ts", "eta/model/cli.ts", "eta/model/loader/check.ts", "eta/docs/stories.md", "eta/docs/bento/README.md", "eta/docs/eta-app-notes.md", "eta/CHANGELOG.md", "eta/VERSION", "eta/update.ts", "eta/package.json", ".claude/skills/eta-app/SKILL.md", ".claude/skills/eta-app/reference/stories.md", ".claude/skills/modelling/SKILL.md", ".claude/skills/delta-doc", ".claude/skills/railroad", ".claude/settings.json", ".claude/hooks/session-start.sh"]) expect({ path, there: existsSync(join(root, path)) }).toEqual({ path, there: true });
    for (const path of ["src/server.ts", "eta/src/server.test.ts", "eta/src/client/app.test.html", "eta/src/server.test.fixture.html", "eta/model/server.test.ts", "eta/model/loader/documents.test.ts", "eta/model/loader/londons", "eta/docs/first-app.md", ".claude/commands/publish.md"]) expect({ path, there: existsSync(join(root, path)) }).toEqual({ path, there: false });
  }, 120000);

  test("the app imports eta by name, never by a path out of src/, and Bun resolves the name to eta/, a workspace", async () => {
    for (const file of filesIn(join(root, "src")).filter((f) => /\.(ts|css|html)$/.test(f))) {
      const text = await Bun.file(join(root, "src", file)).text();
      for (const [, spec] of text.matchAll(/(?:from|import|@import)\s+["'](\.[^"']+)["']/g)) expect({ file, spec, inside: resolve(root, "src", dirname(file), spec!).startsWith(join(root, "src")) }).toEqual({ file, spec, inside: true });
    }
    expect(await Bun.file(join(root, "src/index.ts")).text()).toContain('from "eta/example"');
    expect(await Bun.file(join(root, "src/client/styles.css")).text()).toContain('@import "eta/bento.css"');
    expect(await Bun.file(join(root, "eta/model/index.ts")).text()).toContain('from "../src/example"'); // eta's own imports stay relative, inside eta/
    expect(realpathSync(Bun.resolveSync("eta/stories", join(root, "src")))).toBe(realpathSync(join(root, "eta/src/stories.ts")));
    expect(realpathSync(Bun.resolveSync("eta/client/app", join(root, "src")))).toBe(realpathSync(join(root, "eta/src/client/app.ts")));
    const pkg = await Bun.file(join(root, "package.json")).json();
    expect([pkg.workspaces, pkg.dependencies.eta, (await Bun.file(join(root, "eta/package.json")).json()).name]).toEqual([["eta"], "workspace:*", "eta"]);
  });

  test("it is named for its folder, says which eta it started from, and keeps its model's password out of git", async () => {
    expect(await Bun.file(join(root, "src/page.ts")).text()).toContain('<h1 class="cap">Garden</h1>');
    expect((await Bun.file(join(root, "package.json")).json()).name).toBe("garden");
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain(`Started from [eta](https://github.com/blueshed/eta) ${version}${unreleased ? ", with what its changelog had under Unreleased then" : ""}.`);
    expect(await Bun.file(join(root, "eta/VERSION")).text()).toBe(`${version}${unreleased ? "+unreleased" : ""}\n`);
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

  test("in a Claude Code web session its hook brings the Bun its tests need, and no browser they do not use", () => {
    const { code, out } = run(["bash", ".claude/hooks/session-start.sh", "--dry-run"], { CLAUDE_PROJECT_DIR: root });
    expect(code).toBe(0);
    expect(out).toContain("chromium: not needed"); // the starter's tests use no Bun.WebView; the first that does brings it
    expect(out).toMatch(/wants >=[\d.]+: ok/);
  });

  test("its model's page is its own model, empty, and its people sign in with the password in .env", async () => {
    const env = Object.fromEntries((await Bun.file(join(root, ".env")).text()).split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => l.split("=") as [string, string]));
    const port = String(41000 + Math.floor(Math.random() * 1000));
    const server = Bun.spawn(["bun", "eta/src/start.ts"], { cwd: root, env: { ...process.env, ...env, ETA_EXAMPLE: "./eta/model", PORT: port, DB_PATH: ":memory:" }, stdout: "pipe", stderr: "pipe" });
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

  test("bun run eta:update brings a later eta: eta/ replaced whole, src/ untouched, what to change first, the gate run, nothing committed", async () => {
    await Bun.write(join(root, "eta/VERSION"), "0.52.0\n"); // as if made by 0.52.0
    await Bun.write(join(root, "eta/stray.ts"), "export const edited = true;\n");
    const app = await snapshot(join(root, "src"));
    const { code, out } = run(["bun", "run", "eta:update", eta]); // a path: this checkout, as it stands
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
    expect(out).toContain(`eta 0.52.0 -> ${version}${unreleased ? "+unreleased" : ""}: eta/ replaced whole`);
    const order = ["What to change (eta's changelog, after 0.52.0):", "[0.53.0] **The eta-app skill is a compass**", "in a project, replace `.claude/skills/eta-app` whole", "What else changed:", "[0.53.0] **A failure that says why.**", "The gate:", "bun check: passed", "bun test: passed", "bun run stories: passed", "The gate passes."];
    expect(order.map((line) => out.indexOf(line))).toEqual(order.map((line) => out.indexOf(line)).toSorted((a, b) => a - b));
    expect(order.every((line) => out.includes(line))).toBe(true);
    expect(out).not.toContain("[0.52.0]"); // what it was on already is not said again
    expect(existsSync(join(root, "eta/stray.ts"))).toBe(false);
    expect(await Bun.file(join(root, "eta/VERSION")).text()).toBe(`${version}${unreleased ? "+unreleased" : ""}\n`);
    expect(await snapshot(join(root, "src"))).toEqual(app);
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain(`- On [eta](https://github.com/blueshed/eta) ${version}${unreleased ? "+unreleased" : ""}, from 0.52.0 (\`bun run eta:update\`).`);
    expect(run(["git", "log", "--format=%s"]).out.trim()).toBe("Initial commit (via bun create)");
    expect(run(["git", "status", "--porcelain"]).out).toContain(" M CHANGELOG.md");
  }, 120000);
});

// A project made by v0.53.0, the last eta before eta/: its app in app/, eta's kernel in src/, the model's page in model/.
const before = "v0.53.0";
const tagged = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", `refs/tags/${before}`], { cwd: eta }).exitCode === 0;

describe("a project made before eta/ was", () => {
  test.skipIf(!tagged)(`eta:update moves it once: app/ to src/, importing eta by name; eta's src/ and model/ to eta/ (made by ${before})`, async () => {
    const old = join(parent, "orchard");
    mkdirSync(old);
    await new Bun.Archive(Bun.spawnSync(["git", "archive", "--format=tar", before], { cwd: eta }).stdout).extract(old);
    git(old);
    for (const cmd of [["bun", "install"], ["bun", "create/setup.ts"]]) expect(run(cmd, {}, old).code).toBe(0); // as bun create did then
    expect(readdirSync(old)).toContain("app");

    const { code, out } = run(["bun", join(eta, "create/update.ts"), eta], {}, old); // it has no eta/update.ts: this one, from a checkout
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
    expect(out).toContain("Moved this project to eta's layout, once: app/ is src/");
    expect(out).toContain("The gate passes.");
    for (const path of ["app", "model", "docs", "src/server.ts"]) expect({ path, there: existsSync(join(old, path)) }).toEqual({ path, there: false });
    for (const path of ["src/index.ts", "src/stories.ts", "eta/src/server.ts", "eta/model/index.ts", "eta/VERSION", "eta/update.ts", "migrations/README.md"]) expect({ path, there: existsSync(join(old, path)) }).toEqual({ path, there: true });
    expect(await Bun.file(join(old, "src/index.ts")).text()).toContain('from "eta/example"');
    expect(await Bun.file(join(old, "src/page.ts")).text()).toContain('<h1 class="cap">Orchard</h1>');
    expect(await Bun.file(join(old, "bunfig.toml")).text()).toContain('coveragePathIgnorePatterns = ["**/node_modules/**", "eta/**", "src/stories.ts"]');
    expect((await Bun.file(join(old, "package.json")).json()).scripts["eta:update"]).toBe("bun eta/update.ts");
    expect(run(["git", "log", "--format=%s"], {}, old).out.trim()).toBe("Initial commit (via bun create)");
  }, 180000);
});
