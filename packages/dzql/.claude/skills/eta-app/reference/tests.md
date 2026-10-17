# Tests

The stories are most of the tests ([stories.md](stories.md)). Beside them, test what a story cannot
say, and run the gate.

```ts
// examples/leave/client/app.test.ts (trimmed)
let server: ReturnType<typeof createServer>;
beforeAll(() => { server = createServer(example, 0); });
afterAll(() => { server.stop(true); });

test("a drag across days is a draft, its drawer saying what it would mean; asked for, the bar drags to other days", async () => {
  await using view = webview();
  await view.navigate(urlFor(view, server.url));
  … // signs in, drags across two days
  await waitFor(view, `document.querySelector('.draft-drawer')?.textContent ?? ''`, (v) => String(v).includes("2 working days"));
  await press(view, ".draft-drawer .tool.add"); // Ask
  …
});
```

`webview`, `urlFor`, `waitFor` and `press` are `src/webview.ts`.

- The fast loop: `ETA_EXAMPLE=<name> bun run stories` and the app's own test files
  (`bun test examples/<name>`); the full gate before a commit.
- A test for each document's rules and shapes, called directly, without a server.
- A `server.test.ts` that drives writes and undo over a real websocket (two writes racing), and checks
  that a value is drawn, which no story's `seen` does. `write(ws, doc, ops)` (`src/test-socket.ts`)
  gives each write an id and returns it, so a refused one is answered: `expectMessage(ws, "refused")`.
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
