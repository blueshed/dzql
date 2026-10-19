import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The evolve skill's references, proven: for each file in references/, a new app made from this
// template, with the file's code blocks applied and its `bun add` lines run (after those of the
// files it builds on), passes `bun run typecheck` and `bun test` at 100%.
//
// Not part of `bun test` (the name has no .test): `bun run test:evolve` runs it, and CI does.
// It is about the template, so setup deletes it from a new app.

setDefaultTimeout(600_000);

const root = `${import.meta.dir}/..`;
const references = `${root}/.claude/skills/evolve/references`;
const scratch = mkdtempSync(`${tmpdir()}/evolve-`);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Each reference, and the references it builds on, applied first in this order
const SECTIONS: Record<string, string[]> = {
  "document.md": [],
  "testing.md": ["document.md"],
  "two-documents.md": [],
  "sqlite.md": ["two-documents.md"],
  "migrations.md": ["two-documents.md", "sqlite.md"],
  "postgres.md": ["two-documents.md", "sqlite.md"],
  "auth.md": [],
  "http.md": [],
  "build.md": ["two-documents.md", "sqlite.md"], // built with a history of migrations: they travel in the bundle
};

function run(cwd: string, cmd: string[]) {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString() + proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd}:\n${out}`);
  return out;
}

/** A reference's code blocks: the language, and the lines. */
async function blocks(name: string) {
  const text = await Bun.file(`${references}/${name}`).text();
  return [...text.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map(([, lang, body]) => ({ lang, lines: body!.trimEnd().split("\n") }));
}

/** Apply a section to an app: run its `bun add` lines, and write each block whose first line names a file. */
async function apply(app: string, name: string) {
  for (const { lang, lines } of await blocks(name)) {
    if (lang === "sh") {
      // DZQL_SPEC installs another dzql in place of npm's, as DELTA_SPEC does delta: dzql@<a candidate's tarball>
      for (const line of lines.filter((l) => l.startsWith("bun add "))) run(app, (line === "bun add dzql" && process.env.DZQL_SPEC ? `bun add ${process.env.DZQL_SPEC}` : line).split(/\s+/));
      continue;
    }
    const where = lines[0]!.match(/^\/\/ ([\w./-]+)(?:: (after|before|in place of) (.+))?$/);
    if (!where) throw new Error(`${name}: a block's first line names no file: ${lines[0]}`); // every code block is applied
    const [, path, how, anchor] = where;
    const body = lines.slice(1);
    const file = join(app, path!);
    if (!how) {
      await Bun.write(file, body.join("\n") + "\n");
      continue;
    }
    const text = (await Bun.file(file).text()).split("\n");
    const at = text.findIndex((l) => l.includes(anchor!));
    if (at < 0) throw new Error(`${name}: no line in ${path} holds ${anchor}`);
    const indent = text[at]!.match(/^\s*/)![0];
    text.splice(how === "after" ? at + 1 : at, how === "in place of" ? 1 : 0, ...body.map((l) => (l ? indent + l : l)));
    await Bun.write(file, text.join("\n"));
  }
}

// DELTA_SPEC and RAILROAD_SPEC install another delta or railroad in place of npm's: <name>@<a candidate's
// tarball>. In paintbrush's home (blueshed/dzql) the packages beside it are the candidates, each packed
// once, since the app may already need what they have and npm's do not.
const sibling = (dir: string, name: string): string | undefined => {
  if (!existsSync(`${root}/../${dir}/package.json`)) return undefined;
  const before = new Set(readdirSync(scratch));
  run(`${root}/../${dir}`, ["bun", "pm", "pack", "--destination", scratch, "--quiet"]);
  const tarball = readdirSync(scratch).find((f) => f.endsWith(".tgz") && !before.has(f))!;
  return `${name}@${join(scratch, tarball)}`;
};
const candidates = [process.env.DELTA_SPEC ?? sibling("delta", "@blueshed/delta"), process.env.RAILROAD_SPEC ?? sibling("railroad", "@blueshed/railroad"), process.env.DZQL_SPEC ?? sibling("dzql", "dzql")].filter((s): s is string => s !== undefined);

/** A new app, as bun create makes one: the template's files, installed, then its setup. */
function newApp(name: string) {
  const app = join(scratch, name.toLowerCase().replace(/[^a-z]+/g, "-"));
  const listed = run(root, ["git", "ls-files", "--cached", "--others", "--exclude-standard"]);
  for (const path of listed.split("\n").filter(Boolean)) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(app, path));
  }
  run(app, candidates.length ? ["bun", "add", ...candidates] : ["bun", "install"]);
  run(app, ["bun", "create/setup.ts"]);
  return app;
}

test("every reference is proven here", () => {
  expect(readdirSync(references).sort()).toEqual(Object.keys(SECTIONS).sort());
});

for (const [name, after] of Object.entries(SECTIONS)) {
  test(name, async () => {
    const app = newApp(name);
    for (const section of [...after, name]) await apply(app, section);
    run(app, ["bun", "run", "typecheck"]);
    const out = run(app, ["bun", "test"]);
    console.log(`${name}: ${out.match(/\d+ pass/)?.[0]}, ${out.match(/All files[^\n]*/)?.[0].replace(/\s+/g, " ")}`);
  });
}
