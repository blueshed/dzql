# Testing a route with `Bun.WebView`

In a delta app the factory already exists: `serve(app, { port: 0 })` (`@blueshed/delta/serve`)
returns `{ url, stop }`, so a test starts the app's own routes on any free port and skips the
`startServer` below.

```ts
// server.ts: an importable factory, so a test binds port 0
import indexHtml from "./index.html";

export interface StartOptions { port?: number /* and any data paths to inject */ }

export async function startServer(opts: StartOptions = {}) {
  const server = Bun.serve({
    port: opts.port ?? Number(process.env.PORT ?? 3000),
    routes: { "/": indexHtml },
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  });
  return { server };
}

if (import.meta.main) {
  const { server } = await startServer();
  console.log(`Listening on ${server.url}`);
}
```

```ts
// tests/page.test.ts: one view for the file, by railroad's kit
import { test, expect, afterAll } from "bun:test";
import { browser } from "@blueshed/railroad/webview";
import { startServer } from "../server";

const { server } = await startServer({ port: 0 }); // at the top, before browser()
const { view, open, waitFor, close } = browser(() => server.url);
afterAll(() => {
  close();
  server.stop(true);
});

test("a click shows the answer", async () => {
  await open();
  await view.click("#name");
  await view.type("Ada");
  await waitFor(`!document.querySelector("#submit").disabled`); // click waits for visible, not enabled
  await view.click("#submit");
  await waitFor(`document.querySelector("#out")?.textContent !== ""`);
  expect(await view.evaluate<string>(`document.querySelector("#out").textContent`)).toBe("Hello, Ada");
});
```

The server starts at the file's top level and stops in `afterAll`. The kit makes its first
navigation in a `beforeAll` of its own, registered when `browser()` is called; a server started at
the top stands before any hook runs.

**The rules are the kit's** (`@blueshed/railroad/webview`, the header of `src/webview.ts` in the
package): one view per file, `evaluate` takes a string expression, `await` every call, `type()`
appends (`replaceText` replaces), a second window by `withOtherWindow`. Read them there; what
follows is what the kit does not say.

**In an app without railroad**, use the kit all the same: `bun add -d @blueshed/railroad`. It is
for tests, needs only `bun:test`, and puts nothing in the page. Where the user rules out a dev
dependency, open one `new Bun.WebView({ dataStore: "ephemeral" })` for the file, close it in
`afterAll`, and poll with [webview-recipes](webview-recipes.md)'s `waitFor`.

Working: [create-blueshed/template/tests/site.test.ts](https://github.com/blueshed/dzql/blob/main/packages/create-blueshed/template/tests/site.test.ts),
paintbrush's, a delta app: it starts the app's own routes on port 0 with a throwaway data folder
and drives the page with the kit (through `browser.ts` beside it); railroad's
`tests/webview-examples.test.ts` drives its jobs example so.

The methods and options are Bun's types (`Bun.WebView` in `@types/bun`); read them, not a table. Recipes for what it lacks: [webview-recipes](webview-recipes.md).

- Bun 1.3.12+ for `Bun.WebView`; 1.3.14+ for `clickCount`, the per-call `timeout` and the constructor's `console` and `dataStore`. Check `bun --version` and tell the user if theirs is older.
- `Bun.WebView` is a global, nothing to import; plain `bun test`, no `--browser` flag. macOS uses WKWebView; on Linux and Windows pass `backend: "chrome"`. Input is real OS events (`isTrusted: true`).
- Type every `evaluate`, one whose result is thrown away too: ``await view.evaluate<string>(`location.hash = "#/users/2"`)``. Its default `unknown` makes `expect()` pick the wrong overload. Only JSON-serialisable values cross; no functions or Nodes.
- No `waitForSelector`, `waitForNavigation` or `waitForFunction`. Selector methods wait until the element is attached, visible, stable and unobscured (default 30000 ms), **not** enabled: wait for a disabled button to enable. Anything else (a WebSocket update, a file write): poll.
- `dataStore: "ephemeral"` keeps cookies and storage from leaking between tests; `console: console` (or a callback) forwards or captures page logs.
- Use `server.url.href`, never a hard-coded `localhost:3000`; never start the server with a shell command in `beforeAll`.
- Give the factory a throwaway data path: `mkdtempSync(join(tmpdir(), "app-test-"))` at the top, beside the server; `rmSync(dir, { recursive: true, force: true })` in `afterAll`.
- `cdp(method, params)` (DevTools Protocol) works only on the `chrome` backend.
