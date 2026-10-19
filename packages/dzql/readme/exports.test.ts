import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// dzql's public API is its named exports: what an app imports, and nothing else. No wildcard: a
// module not listed is dzql's own and may change. Every `dzql/...` path an example, a skill, a
// README or a doc names is one of them, and every one is a file.
const root = join(import.meta.dir, "..");
const exported = Object.entries(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports as Record<string, string>);

test("every export is a file, and none is a wildcard", () => {
  for (const [name, file] of exported) {
    expect(name, name).not.toContain("*");
    expect(existsSync(join(root, file)), `${name} → ${file}`).toBe(true);
  }
});

test("every dzql path the examples, skills and docs name is exported", async () => {
  const names = new Set(exported.map(([name]) => `dzql${name.slice(1)}`));
  const said = new Map<string, string>();
  const where = [
    [root, "{examples,src,readme,.claude}/**/*.{ts,tsx,md,css}"],
    [join(root, ".."), "{paintbrush,create-dzql}/**/*.{ts,tsx,md}"],
    [join(root, "..", ".."), "{README.md,docs/**/*.md}"],
  ] as const;
  for (const [dir, pattern] of where)
    for await (const file of new Bun.Glob(pattern).scan({ cwd: dir, dot: true })) {
      if (file.includes("node_modules")) continue;
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(/["'`](dzql\/[a-z][a-zA-Z0-9_./-]*?)(?:\.ts)?["'`]/g)) said.set(m[1]!, file);
    }
  const missing = [...said].filter(([path]) => !names.has(path) && !path.startsWith("dzql/examples/"));
  expect(missing).toEqual([]);
});
