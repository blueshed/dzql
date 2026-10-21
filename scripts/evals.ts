#!/usr/bin/env bun
/**
 * `bun scripts/evals.ts [out dir] [--only <package>/<skill>[,…]]`: every scenario of every shipped
 * skill's evaluations (`packages/<package>/evals/<skill>.json`, and create-blueshed's template's),
 * each run as a fresh `claude -p` session, as the Shed's driver runs a stage: given the scenario's
 * query word for word, with nobody stepping in. Each runs in a project of its own made from this
 * checkout's packages, never npm's (the skills teach what the checkout does), its starting point
 * committed, so what the session did is the diff. After each: `bun check` and `bun test`, and the
 * whole record in `<out>/results.json`. Grading each expected line is the next step, by a reader
 * of the diff and the log, and a run is recorded in the package's `evals/runs/<date>-<skill>.md`.
 *
 * A scenario says where it starts (`start`): an empty folder, a folder with railroad or delta from
 * the checkout, or an app as `bun create dzql` or `bun create blueshed` make one (`--local`); by
 * default, its package's. `after: <n>` starts from what scenario n of the same skill left;
 * `copy: [{ from, to, at?, replace? }]` puts a file or folder of the repository in (at a revision, if
 * `at` says one; in place of what is there, with `replace`), and a tsconfig it brings that extends one
 * left behind is made to stand alone.
 *
 * The checkout's packages are installed as npm ships them (packed), never as links a search will not
 * follow. Each scenario has ports of its own (`PORT`, `MODEL_PORT`), and whatever a session leaves
 * running in its folder is stopped when it ends. An empty start is a person's: what its session
 * installs (`bun add`) comes from npm, so a skill is measured against what npm has.
 */
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { packer } from "./packed";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : undefined;
const out = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only") ?? join(process.env.HOME!, "Workshop", `evals-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(out, { recursive: true });

type Scenario = { skills: string[]; query: string; expected_behavior: string[]; start?: Start; after?: number; copy?: { from: string; to: string; at?: string; replace?: boolean }[] };
type Start = "empty" | "railroad" | "delta" | "dzql" | "blueshed";
type Result = { id: string; pkg: string; skill: string; n: number; dir: string; minutes: number; exit: number | null; check: boolean; tests: { pass: number; fail: number; exit: number; none?: true } | null; files: string[] };

// each package's evaluations, and the start its scenarios take unless they say
const sources: { pkg: string; dir: string; start: Start; skills: string }[] = [
  { pkg: "railroad", dir: "packages/railroad/evals", start: "railroad", skills: "packages/railroad/.claude/skills" },
  { pkg: "delta", dir: "packages/delta/evals", start: "delta", skills: "packages/delta/.claude/skills" },
  { pkg: "dzql", dir: "packages/dzql/evals", start: "dzql", skills: "packages/dzql/.claude/skills" },
  { pkg: "create-blueshed", dir: "packages/create-blueshed/template/evals", start: "blueshed", skills: "packages/create-blueshed/template/.claude/skills" },
];
const runs: { id: string; pkg: string; skill: string; n: number; s: Scenario; start: Start }[] = [];
for (const src of sources)
  for (const file of readdirSync(join(root, src.dir)).filter((f) => f.endsWith(".json"))) {
    const skill = file.replace(/\.json$/, "");
    if (only && !only.includes(`${src.pkg}/${skill}`)) continue;
    const list = (await Bun.file(join(root, src.dir, file)).json()) as Scenario[];
    list.forEach((s, i) => runs.push({ id: `${src.pkg}-${skill}-${i + 1}`, pkg: src.pkg, skill, n: i + 1, s, start: s.start ?? src.start }));
  }

/** The package that ships each skill. */
const OWNER: Record<string, string> = { railroad: "railroad", "bun-route": "railroad", "delta-doc": "delta", "dzql-app": "dzql", modelling: "dzql", evolve: "create-blueshed/template" };

const sh = (cmd: string[], cwd: string) => Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "" } });

/** The checkout's packages as npm would ship them: one tarball each, packed once a run (`packed.ts`). */
const { tarball, ship } = packer(join(out, ".packed"));

/** A copied tsconfig that extends one outside what was copied stands alone: what it extends, inlined. */
function standalone(copied: string, from: string): void {
  const file = existsSync(join(copied, "tsconfig.json")) ? join(copied, "tsconfig.json") : copied.endsWith("tsconfig.json") ? copied : undefined;
  if (!file) return;
  let own = JSON.parse(readFileSync(file, "utf8")) as { extends?: string; compilerOptions?: object };
  let base = file === copied ? dirname(from) : from;
  while (own.extends && !existsSync(resolve(dirname(file), own.extends))) {
    const parent = resolve(base, own.extends);
    const up = JSON.parse(readFileSync(parent, "utf8")) as typeof own;
    const { extends: _, ...rest } = own;
    own = { ...up, ...rest, compilerOptions: { ...up.compilerOptions, ...rest.compilerOptions } };
    base = dirname(parent);
  }
  const { "//": _said, ...alone } = own as typeof own & { "//"?: string }; // the repository's note on its own layout
  writeFileSync(file, JSON.stringify(alone, null, 2) + "\n");
}

/** Every process still running in a folder: a server a session started and left. */
function stopLeftIn(dir: string): number[] {
  const lsof = Bun.spawnSync(["lsof", "-a", "-d", "cwd", "-Fpn"], { cwd: root, stdout: "pipe", stderr: "pipe" }); // from outside the folder, or it finds itself
  const lines = lsof.stdout.toString().split("\n");
  const pids: number[] = [];
  for (let i = 0, pid = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("p")) pid = Number(lines[i]!.slice(1));
    else if (lines[i]!.startsWith("n") && (lines[i]!.slice(1) === dir || lines[i]!.slice(1).startsWith(`${dir}/`)) && pid !== process.pid && pid !== lsof.pid) pids.push(pid);
  }
  for (const pid of pids) try { process.kill(pid); } catch {}
  return pids;
}

/** A project as the scenario starts it, committed. */
async function make(r: (typeof runs)[number], dir: string): Promise<void> {
  const local = (names: string[]) => Object.fromEntries(names.map((n) => [`@blueshed/${n}`, `file:${tarball(n)}`]));
  const bare = (names: string[], skills: string[]) => {
    mkdirSync(dir, { recursive: true });
    const deps = local(names);
    // an empty start is empty: no package.json, as the skills define one
    if (names.length) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", type: "module", private: true, dependencies: deps, overrides: deps }, null, 2) + "\n");
    if (names.length) sh(["bun", "install"], dir);
    // each skill from the package that ships it, never a copy another keeps (delta's of railroad's is git-ignored and may be stale)
    for (const s of skills) cpSync(join(root, "packages", OWNER[s]!, ".claude/skills", s), join(dir, ".claude/skills", s), { recursive: true });
  };
  if (r.s.after) {
    const from = join(out, `${r.pkg}-${r.skill}-${r.s.after}`);
    sh(["cp", "-R", from, dir], out);
    sh(["git", "add", "-A"], dir);
    sh(["git", "commit", "-qm", `start: from ${r.pkg}-${r.skill}-${r.s.after}`, "--allow-empty"], dir);
  } else if (r.start === "empty") bare([], r.s.skills);
  else if (r.start === "railroad") bare(["railroad"], ["railroad", "bun-route"]);
  else if (r.start === "delta") bare(["railroad", "delta"], ["delta-doc", "railroad"]);
  else {
    // a starter takes the app's name, made in the folder it is run from
    const made = sh(["bun", join(root, `packages/create-${r.start === "dzql" ? "dzql" : "blueshed"}/cli.ts`), r.id, "--local"], out);
    if (!existsSync(dir)) throw new Error(`${r.id}: the starter made nothing: ${made.stderr.toString()}${made.stdout.toString()}`);
  }
  for (const c of r.s.copy ?? []) {
    const to = join(dir, c.to);
    if (c.replace) rmSync(to, { recursive: true, force: true });
    mkdirSync(join(to, ".."), { recursive: true });
    if (c.at) await Bun.write(to, (await $`git show ${c.at}:${c.from}`.cwd(root).quiet()).stdout);
    else {
      cpSync(join(root, c.from), to, { recursive: true });
      standalone(to, join(root, c.from));
    }
  }
  // a copy that brings a package.json is installed as it would be (an empty start's from npm, as a person's),
  // the checkout's packages as tarballs
  ship(dir);
  if (!existsSync(join(dir, ".git"))) sh(["git", "init", "-q"], dir);
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  sh(["git", "add", "-A"], dir);
  sh(["git", "commit", "-qm", "start", "--allow-empty"], dir);
  sh(["git", "tag", "-f", "start"], dir); // what the session did is start..HEAD, however many commits it made
}

/** One scenario: its project, the session, then what it left. */
async function run(r: (typeof runs)[number]): Promise<Result> {
  const dir = join(out, r.id);
  try {
    await make(r, dir);
  } catch (err) {
    console.error(String(err));
    return { id: r.id, pkg: r.pkg, skill: r.skill, n: r.n, dir, minutes: 0, exit: -1, check: false, tests: null, files: [] };
  }
  await Bun.write(join(out, `${r.id}.prompt.md`), r.s.query);
  if (process.env.EVALS_SETUP_ONLY) return { id: r.id, pkg: r.pkg, skill: r.skill, n: r.n, dir, minutes: 0, exit: null, check: sh(["bun", "check"], dir).exitCode === 0, tests: null, files: [] };
  const started = performance.now();
  // ports of its own, so scenarios running at once never meet on 3000 or the model's 3001
  const port = 4000 + runs.indexOf(r) * 10;
  const env = { ...process.env, CI: "", PORT: String(port), MODEL_PORT: String(port + 1) };
  const proc = Bun.spawn(["claude", "-p", r.s.query, "--allowedTools", "Bash,Edit,Write,Read,Glob,Grep,MultiEdit,TodoWrite,Skill", "--permission-mode", "acceptEdits", "--output-format", "text"], { cwd: dir, env, stdout: Bun.file(join(out, `${r.id}.log`)), stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), 45 * 60_000);
  const exit = await proc.exited;
  clearTimeout(timer);
  const left = stopLeftIn(dir);
  if (left.length) console.error(`${r.id}: stopped what the session left running (${left.join(", ")})`);
  const minutes = +((performance.now() - started) / 60000).toFixed(1);
  sh(["git", "add", "-A"], dir);
  sh(["git", "commit", "-qm", "the session"], dir);
  const files = sh(["git", "diff", "--name-only", "start", "HEAD"], dir).stdout.toString().split("\n").filter(Boolean);
  await Bun.write(join(out, `${r.id}.diff`), sh(["git", "diff", "start", "HEAD", "--", ".", ":!bun.lock", ":!**/bun.lock"], dir).stdout);
  const check = sh(["bun", "check"], dir).exitCode === 0;
  // the project's own test script where it has one (a preload it says there, which a session may not write into bunfig.toml)
  const pkg = existsSync(join(dir, "package.json")) ? (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> }) : undefined;
  const t = pkg ? sh(pkg.scripts?.test ? ["bun", "run", "test"] : ["bun", "test"], dir) : null;
  const text = t ? t.stdout.toString() + t.stderr.toString() : "";
  // a project with no test file is no failing test: none, said so
  const none = /\b0 test files\b|No tests found/i.test(text);
  const tests = t ? { pass: Number(/^ *(\d+) pass/m.exec(text)?.[1] ?? 0), fail: Number(/^ *(\d+) fail/m.exec(text)?.[1] ?? 0), exit: none ? 0 : t.exitCode ?? -1, ...(none ? { none: true as const } : {}) } : null;
  const result = { id: r.id, pkg: r.pkg, skill: r.skill, n: r.n, dir, minutes, exit, check, tests, files };
  console.log(JSON.stringify(result));
  return result;
}

// those that start from another wait for it; the rest four at a time
const results: Result[] = [];
const done = new Map<string, Promise<Result>>();
const queue = [...runs];
const slots = Number(process.env.EVALS_AT_ONCE ?? 4);
let running = 0;
await new Promise<void>((resolve) => {
  const next = () => {
    if (!queue.length && !running) return resolve();
    while (running < slots) {
      const i = queue.findIndex((r) => !r.s.after || done.has(`${r.pkg}-${r.skill}-${r.s.after}`));
      if (i < 0) return;
      const r = queue.splice(i, 1)[0]!;
      const after = r.s.after ? done.get(`${r.pkg}-${r.skill}-${r.s.after}`)! : Promise.resolve(null);
      running++;
      const p = after.then(() => run(r));
      done.set(r.id, p);
      p.then((res) => results.push(res)).finally(() => {
        running--;
        writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
        next();
      });
    }
  };
  next();
});
console.log(`${results.length} scenarios in ${out}`);
