# Tests

The stories are most of the tests ([stories.md](stories.md)). Beside them, test what a story cannot
say, and run the gate.

```ts
// examples/leave/client/app.test.ts (trimmed)
let server: ReturnType<typeof createServer>;
beforeAll(() => { server = createServer(example, 0); });
afterAll(() => { server.stop(true); });

test("a draft asked for from its drawer", async () => {
  await using view = webview();
  await view.navigate(urlFor(view, server.url));
  await waitFor(view, `document.querySelector('.calendar-view .month') !== null`, (v) => v === true);
  await press(view, ".draft-drawer .tool.add");
  …
});
```

`webview`, `urlFor`, `waitFor` and `press` are `src/webview.ts`.

- A test for each document's rules and shapes, called directly, without a server.
- A `server.test.ts` that drives writes and undo over a real websocket (two writes racing).
- A `client/app.test.ts` for what only a browser can show (`Bun.WebView`, on Chrome).
- Open a view with `webview()`, never `new Bun.WebView()`: only `webview()` is measured for the
  client's coverage (`src/client-coverage.ts`).
- Press as a mouse does, with `press(view, selector)`, never `element.click()`: that sends no pointer
  events and reaches a control whatever covers it, so a tap that goes nowhere passes. `press` throws
  for a control that is disabled or covered, naming what covers it.
- The gate: `bun check`, `bun test` (100% coverage) and `bun run stories`. `.env.test` keeps the
  tests off the dev database.
- The browser tests need Chrome or Chromium: `BUN_CHROME_PATH` names it where it is not found. In a
  Claude Code web session the SessionStart hook (`.claude/hooks/session-start.sh`) stages it and
  brings Bun up to `engines.bun`; `--dry-run` says what it would do.
