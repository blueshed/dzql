#!/usr/bin/env bun
/**
 * `bun scripts/docs.ts`: what people and Claude read is held to the code. In every live Markdown file
 * (not a CHANGELOG, not history, not an eval's run): each relative link resolves, and each link to this
 * repository on GitHub names a file in the checkout (a skill links its package's examples so: they do not ship); each
 * `packages/...` path it names exists; and in a package's skills, CLAUDE.md and README, each `src/`,
 * `examples/`, `tests/` or `scripts/` path it names exists in that package. And every skill a
 * package ships (`.claude/skills/<name>/SKILL.md`, in git) has its evaluations beside it
 * (`evals/<name>.json`): a skill is tested by a fresh session led by it, as code is by its tests.
 * And each of a shipped skill's reference pages (`reference/*.md`, `references/*.md`, `reference.md`)
 * has a line starting `Working:`, saying where its rules are shown working: an example its package's
 * tests run, the test that runs the page as written, or `none` and why. And the evolve skill's
 * thin-client step carries create-dzql's CLAUDE.md and README word for word.
 * `bun run affected` runs it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const live = (f: string) => f.endsWith(".md") && !f.endsWith("CHANGELOG.md") && !f.startsWith("docs/history/") && !f.includes("/evals/") && !f.includes("node_modules");
const files = (await $`git ls-files -co --exclude-standard`.cwd(root).quiet().text()).split("\n").filter(live).filter((f) => existsSync(join(root, f)));

const wrong: string[] = [];
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  // a starter's template is an app of its own: its docs' src/ and tests/ are its own
  const pkg = /^packages\/[^/]+\/(template\/)?/.exec(file)?.[0];
  for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const to = m[1]!;
    if (!/^[a-z]+:/.test(to) && !existsSync(normalize(join(root, dirname(file), to)))) wrong.push(`${file}: a link to ${to}, which is not there`);
    // a link to this repository on GitHub (how a skill, which ships without the examples, names one) names a file here
    const here = /^https:\/\/github\.com\/blueshed\/dzql\/(?:blob|tree)\/main\/(.+)$/.exec(to)?.[1];
    if (here && !existsSync(join(root, here))) wrong.push(`${file}: a link to ${here} on GitHub, which is not in this checkout`);
  }
  for (const m of text.matchAll(/`((packages|src|examples|tests|scripts)\/[A-Za-z0-9_./-]*[A-Za-z0-9_])`/g)) {
    const [, path, top] = m;
    if (/[*<>]/.test(path!) || path!.includes("...")) continue;
    const at = top === "packages" ? join(root, path!) : pkg ? join(root, pkg, path!) : join(root, path!);
    if (top !== "packages" && !pkg) continue; // a root doc's src/ is some package's: say which, as packages/<name>/
    // a project's own src/, as the two starters lay a project out (each one's template)
    const project = top === "src" && ["packages/create-dzql/template", "packages/create-blueshed/template"].some((s) => existsSync(join(root, s, path!)));
    if (!existsSync(at) && !project) wrong.push(`${file}: names ${path}, which is not there`);
  }
}
// a shipped skill, its evaluations: a vendored copy (delta's railroad, git-ignored) is its own package's;
// a template's skill (create-blueshed's evolve) has them in the template, beside it
const skills = (await $`git ls-files packages/*/.claude/skills/*/SKILL.md packages/*/template/.claude/skills/*/SKILL.md`.cwd(root).quiet().text()).split("\n").filter(Boolean);
for (const skill of skills) {
  const [, pkg, name] = /^(packages\/[^/]+(?:\/template)?)\/\.claude\/skills\/([^/]+)\//.exec(skill)!;
  if (!existsSync(join(root, pkg!, "evals", `${name}.json`))) wrong.push(`${pkg}: ships the ${name} skill with no evaluations (evals/${name}.json)`);
}
// a shipped skill's reference pages: each says where its rules are shown working
const globs = skills.map(dirname).flatMap((d) => [`${d}/reference/*.md`, `${d}/references/*.md`, `${d}/reference.md`]);
const pages = (await $`git ls-files ${globs}`.cwd(root).quiet().text()).split("\n").filter(Boolean);
for (const page of pages) {
  if (!/^Working: /m.test(readFileSync(join(root, page), "utf8"))) wrong.push(`${page}: says nowhere where its rules are shown working (a line starting "Working:")`);
}
// the evolve skill's step to the thin client leaves an app as `bun create dzql` makes one: its
// CLAUDE.md and README are create-dzql's, word for word, under the app's own heading
const step = "packages/create-blueshed/template/.claude/skills/evolve/references/thin-client.md";
const stepText = readFileSync(join(root, step), "utf8");
for (const doc of ["CLAUDE.md", "README.md"]) {
  const block = new RegExp(`^(\`{4,})md\\n// ${doc}: under its heading\\n([\\s\\S]*?)^\\1$`, "m").exec(stepText)?.[2];
  const starter = /^# .*\n\n([\s\S]*)$/.exec(readFileSync(join(root, "packages/create-dzql/template", doc), "utf8"))?.[1];
  if (block === undefined || block !== starter) wrong.push(`${step}: its ${doc} is not create-dzql's (packages/create-dzql/template/${doc}) under the app's heading`);
}
if (wrong.length) {
  console.error(wrong.join("\n"));
  console.error(`\n${wrong.length} place${wrong.length === 1 ? "" : "s"} where the docs and the code disagree`);
  process.exit(1);
}
console.log(`docs: ${files.length} files, every link and path there; ${skills.length} skills, each with its evaluations; ${pages.length} reference pages, each saying where it works`);
