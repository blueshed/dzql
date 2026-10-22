#!/usr/bin/env bun
// dzql's tests but the Postgres server's (those are `bun run test:pg`): modelling's, rendering's,
// the README's and every example's.
//
//   bun scripts/tests.ts          every one, the browser's too, held to 100% coverage (`bun run test:coverage`)
//   bun scripts/tests.ts --fast   no browser and no coverage gate, in parallel: the fast tier's part
//   --ci                          the CI runner's slower machine: fewer workers
//
// Every run gives a test 30 s, not bun's 5: a PGlite store starts in the process, and on a slower
// machine (the cloud sandbox, a busy laptop) that passed 5 s (root #144).
//
// A part of the suite cannot meet bunfig.toml's 100%, which only the whole run is held to, and Bun
// says so only by its exit code: so the fast run passes on every test passing, and nothing else.
import { EXAMPLES } from "./examples";

const fast = process.argv.includes("--fast");
const ci = process.argv.includes("--ci");
const DIRS = ["tests/rendering", "tests/modelling", "tests/readme", ...EXAMPLES.map((e) => `examples/${e}`)];
// what needs a browser: left out of the fast run
const BROWSER = ["tests/rendering/bento.test.ts", "tests/rendering/client-coverage.test.ts", "tests/rendering/applet.test.ts", "tests/rendering/webview.test.ts", "tests/rendering/client/**", "tests/modelling/by-hand.test.ts", "tests/modelling/costs.test.ts", "examples/*/client/**", "tests/readme/browser.test.ts"];
const args = ["--timeout=30000", ...(ci ? ["--parallel=2"] : ["--parallel"]), ...DIRS, ...(fast ? BROWSER.map((p) => `--path-ignore-patterns=${p}`) : [])];
const extra = process.argv.slice(2).filter((a) => a !== "--fast" && a !== "--ci");

if (!fast) process.exit(await Bun.spawn(["bun", "test", ...args, ...extra], { cwd: `${import.meta.dir}/..`, stdout: "inherit", stderr: "inherit" }).exited);

const proc = Bun.spawn(["bun", "test", ...args, ...extra], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
let out = "";
const pipe = async (stream: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
  for await (const chunk of stream) {
    const text = new TextDecoder().decode(chunk);
    if (!/^[ -]*\S.*\|.*\|/m.test(text) || /fail|error/i.test(text)) to.write(text); // the coverage table is the whole run's to show
    out += text;
  }
};
await Promise.all([pipe(proc.stdout, process.stdout), pipe(proc.stderr, process.stderr)]);
const code = await proc.exited;
const passed = /^ 0 fail$/m.test(out) && /^Ran \d+ tests/m.test(out);
process.exit(code === 0 || passed ? 0 : code || 1);
