#!/usr/bin/env bun
// eta's fast tier (`bun run test:fast:eta`): its tests that need no browser, in parallel. A part of
// the suite cannot meet bunfig.toml's 100% coverage, which only the whole run (`test:eta`) is held
// to, and Bun says so only by its exit code: so this passes on every test passing, and nothing else.
const BROWSER = ["src/rendering/bento.test.ts", "src/rendering/client-coverage.test.ts", "src/rendering/island.test.ts", "src/rendering/webview.test.ts", "src/rendering/client/**", "src/modelling/by-hand.test.ts", "src/modelling/costs.test.ts", "examples/*/client/**", "readme/browser.test.ts"];
const DIRS = ["src/rendering", "src/modelling", "readme", ...["chat", "leave", "modeling", "starter", "ticker", "wedding"].map((e) => `examples/${e}`)];
const proc = Bun.spawn(["bun", "test", "--parallel", ...DIRS, ...BROWSER.map((p) => `--path-ignore-patterns=${p}`), ...process.argv.slice(2)], {
  cwd: `${import.meta.dir}/..`,
  stdout: "pipe",
  stderr: "pipe",
});
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
