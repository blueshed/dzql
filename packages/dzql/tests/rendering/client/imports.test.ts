import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

// What a page's bundle takes of the kernel -- the client, and an applet drawn by railroad an example's client mounts --
// reaches nothing only a server has: the documents, the database, the server, a refusal, the
// harness, what a drawing read, the resources, delta's server side, Bun's and Node's own. Walked
// through what each really imports, as a bundle would (a type-only import goes), the way an app's
// own browser-safe check walks it (an app's own browser-safe test), so the kernel breaks
// no app's rule.

const ROOT = resolve(import.meta.dir, "../../..");
const ENTRIES = ["src/rendering/client/app.ts", "src/rendering/applet.ts"];

/** A module only a server has. */
const serverOnly = (spec: string, file: string): boolean =>
  /^(bun|node):/.test(spec) || /\/src\/(rendering\/(documents|db|server|refusal|reading|resources\/)|modelling\/harness)/.test(file) || /@blueshed\/delta\/(sqlite|server|local|postgres|kinds)/.test(spec);

const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Whatever server-only module `entry` reaches, by the chain that got there. */
async function reach(entry: string): Promise<string[]> {
  const reached = new Set<string>();
  const bad: string[] = [];
  const walk = async (file: string, chain: string[]): Promise<void> => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const { path: spec } of transpiler.scanImports(await Bun.file(file).text())) {
      const next = spec.startsWith("bun:") || spec.startsWith("node:") ? spec : Bun.resolveSync(spec, dirname(file));
      if (serverOnly(spec, next)) bad.push([...chain, relative(ROOT, file), spec].join(" -> "));
      else if (next.startsWith(`${ROOT}/src/`)) await walk(next, [...chain, relative(ROOT, file)]); // the kernel's own; a package (railroad) is the browser's
    }
  };
  await walk(resolve(ROOT, entry), []);
  return bad;
}

describe("what a page's bundle imports of the kernel", () => {
  for (const entry of ENTRIES) test(`${entry} reaches nothing of the server's`, async () => expect(await reach(entry)).toEqual([]));

  test("the walk would say so if one did", async () => {
    expect((await reach("src/modelling/stories-run.ts")).some((chain) => chain.endsWith("./harness"))).toBe(true);
  });
});

// railroad is an optional peer only an applet drawn by it needs (src/rendering/applet.ts), and
// delta's client imports railroad: so no other module of dzql's names either, statically or by a
// written import(), or a thin app, which has no railroad, fails its type check in node_modules
describe("what needs railroad, only an applet imports", () => {
  const named = async () => {
    const found: string[] = [];
    for (const file of new Bun.Glob("src/**/*.ts").scanSync(ROOT)) {
      if (file === "src/rendering/applet.ts" || file.startsWith("src/modelling/page/")) continue; // the applet; the model's page is an app of its own, with railroad
      for (const { path: spec } of transpiler.scanImports((await Bun.file(resolve(ROOT, file)).text()).replace(/^#!.*\n/, "")))
        if (/^@blueshed\/(railroad|delta\/client)/.test(spec)) found.push(`${file} -> ${spec}`);
    }
    return found;
  };
  test("no module but the applet names railroad or delta's client", async () => expect(await named()).toEqual([]));
});
