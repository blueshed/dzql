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
  "http.md": [],
  "build.md": [],
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
      for (const line of lines.filter((l) => l.startsWith("bun add "))) run(app, line.split(/\s+/));
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

/** A new app, as bun create makes one: the template's files, installed, then its setup. */
function newApp(name: string) {
  const app = join(scratch, name.toLowerCase().replace(/[^a-z]+/g, "-"));
  const listed = run(root, ["git", "ls-files", "--cached", "--others", "--exclude-standard"]);
  for (const path of listed.split("\n").filter(Boolean)) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(app, path));
  }
  // DELTA_SPEC installs another delta in place of the locked one: @blueshed/delta@<a candidate's tarball>
  const delta = process.env.DELTA_SPEC;
  run(app, delta ? ["bun", "add", delta] : ["bun", "install", "--frozen-lockfile"]);
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
