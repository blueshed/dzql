# Build for production

Optional. `bun run start` serves `src/main.ts` from source with `NODE_ENV=production`: hot reload off, the page bundled on its first request. Build only when a faster start or a single bundle is worth a step.

```jsonc
// package.json: after "scripts": {
"build": "bun build src/main.ts --target=bun --outdir=dist --production",
"serve:dist": "NODE_ENV=production bun --cwd dist main.js",
```

Test it by building, starting `main.js` in `dist/`, and checking the page has no hot reload:

```ts
// tests/build.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = `${import.meta.dir}/..`;

test("the build serves the page, without hot reload", async () => {
  expect(Bun.spawnSync([process.execPath, "run", "build"], { cwd: root }).exitCode).toBe(0);

  const dataDir = mkdtempSync(`${tmpdir()}/build-`);
  const proc = Bun.spawn([process.execPath, "main.js"], {
    cwd: `${root}/dist`,
    env: { ...process.env, NODE_ENV: "production", PORT: "0", PID_FILE: `${dataDir}/.server.pid`, DATA_PATH: dataDir },
    stdout: "pipe",
  });
  try {
    let out = "";
    for await (const chunk of proc.stdout) {
      out += new TextDecoder().decode(chunk);
      if (/Listening on \S+/.test(out)) break;
    }
    const html = await (await fetch(out.match(/Listening on (\S+)/)![1]!)).text();
    expect(html).toContain('<div id="app">');
    expect(html).not.toContain("data-bun-dev-server-script");
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
```

- `--production` matters: without it the built server runs with hot reload on.
- **Not with migrations yet**: a resource loads its history from the `migrations` folder beside its source (`import.meta.dir`), and in a bundle that is `dist/`, where none are. An app with a history (sqlite.md on) runs from source, `bun run start` (todo #11).
- `dist/` is git-ignored. In `.railway/railway.ts`: `build: "bun install && bun run build"`, `start: "bun run serve:dist"`.
