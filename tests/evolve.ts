import { test, afterAll, setDefaultTimeout } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The evolve skill's references, proven: for each section, a new app made from this template,
// with the section's code blocks applied and its `bun add` lines run (after those of the sections
// it builds on), passes `bun run typecheck` and `bun test` at 100%.
//
// Not part of `bun test` (the name has no .test): `bun run test:evolve` runs it, and CI does.
// It is about the template, so setup deletes it from a new app.

setDefaultTimeout(600_000);

const root = `${import.meta.dir}/..`;
const references = await Bun.file(`${root}/.claude/skills/evolve/references.md`).text();
const scratch = mkdtempSync(`${tmpdir()}/evolve-`);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Each section, and the sections it builds on, applied first in this order
const SECTIONS: Record<string, string[]> = {
  "A new document": [],
  "Two documents on one page": [],
  "Store documents in SQLite": ["Two documents on one page"],
  "Store in Postgres": ["Two documents on one page", "Store documents in SQLite"],
  "Serve what isn't communication": [],
  "Build for production": [],
};

function run(cwd: string, cmd: string[]) {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString() + proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd}:\n${out}`);
  return out;
}

/** A section's code blocks, from its heading to the next: the language, and the lines. */
function blocks(name: string) {
  const start = references.indexOf(`\n## ${name}\n`);
  if (start < 0) throw new Error(`references.md has no section "${name}"`);
  const end = references.indexOf("\n## ", start + 1);
  const text = references.slice(start, end < 0 ? undefined : end);
  return [...text.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map(([, lang, body]) => ({ lang, lines: body!.trimEnd().split("\n") }));
}

/** Apply a section to an app: run its `bun add` lines, and write each block whose first line names a file. */
async function apply(app: string, name: string) {
  for (const { lang, lines } of blocks(name)) {
    if (lang === "sh") {
      for (const line of lines.filter((l) => l.startsWith("bun add "))) run(app, line.split(/\s+/));
      continue;
    }
    const where = lines[0]!.match(/^\/\/ ([\w./-]+)(?:: (after|before) (.+))?$/);
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
    text.splice(how === "after" ? at + 1 : at, 0, ...body.map((l) => (l ? indent + l : l)));
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
  run(app, ["bun", "install", "--frozen-lockfile"]);
  run(app, ["bun", "create/setup.ts"]);
  return app;
}

for (const [name, after] of Object.entries(SECTIONS)) {
  test(name, async () => {
    const app = newApp(name);
    for (const section of [...after, name]) await apply(app, section);
    run(app, ["bun", "run", "typecheck"]);
    const out = run(app, ["bun", "test"]);
    console.log(`${name}: ${out.match(/\d+ pass/)?.[0]}, ${out.match(/All files[^\n]*/)?.[0].replace(/\s+/g, " ")}`);
  });
}
