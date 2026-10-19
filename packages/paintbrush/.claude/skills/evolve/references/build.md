# Build for production

Optional. `bun run start` serves `src/routes.ts` from source with `NODE_ENV=production`: hot reload off, the page bundled on its first request. Build only when a faster start or a single bundle is worth a step.

```jsonc
// package.json: after "scripts": {
"build": "bun build src/routes.ts --target=bun --outdir=dist --production",
"serve:dist": "NODE_ENV=production bun --cwd dist routes.js",
```

Its story, then its test: build, start `routes.js` in `dist/`, and check the page has no hot reload:

```ts
// stories.ts: after export const stories = {
  // The build
  built: story("The built site serves the same page, with no hot reload."),
```

```ts
// tests/build.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { stories } from "../stories";

const root = `${import.meta.dir}/..`;

test(`${stories.built.name} -- built, started from dist/, the page has no hot reload`, async () => {
  expect(Bun.spawnSync([process.execPath, "run", "build"], { cwd: root }).exitCode).toBe(0);

  const dataDir = mkdtempSync(`${tmpdir()}/build-`);
  const proc = Bun.spawn([process.execPath, "routes.js"], {
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
- **Migrations travel in the bundle**: a resource imports its history as one module (`migrations/index.ts`, which `delta migrations make` writes), never reads a folder beside its source, which a bundle has none of.
- `dist/` is git-ignored. In `.railway/railway.ts`: `build: "bun install && bun run build"`, `start: "bun run serve:dist"`.
