# Tests

What to test beside the stories ([stories.md](stories.md)), how a browser test presses, and the gate.

The stories are most of the tests. Beside them, for what a story cannot say:

- a test for each document's rules and shapes, called directly;
- a `server.test.ts` that drives writes and undo over a real websocket (two writes racing);
- a `client/app.test.ts` for what only a browser can show (`Bun.WebView`: open each view with
  `webview()`, on Chrome, at `urlFor(view, server.url)`, and wait with `waitFor`, all `src/webview.ts`).

Press as a mouse does, never with `element.click()`: it sends no pointerdown or pointerup and
reaches a control whatever is drawn over it, so a tap that goes nowhere passes. `press`
(`src/webview.ts`) scrolls to the control, presses and lets go at its middle, then clicks where a
browser would; it throws for a control that is disabled or covered, naming what covers it.

```ts
await press(view, "#quote-FXTR button");
await waitFor(view, `document.querySelector('.drawer h2')?.textContent`, (v) => v === "FXTR");
```

The gate is `bun check`, `bun test` (100% coverage) and the stories. `.env.test` keeps the tests
off the dev database. The browser tests need Chrome or Chromium on every platform:
`BUN_CHROME_PATH` names it where it is not found. In a Claude Code web session the SessionStart
hook (`.claude/hooks/session-start.sh`, Bun only, nothing on a Mac) stages it, sets that, and
brings Bun up to `engines.bun`; `--dry-run` says what it would do. The client is in the coverage
gate too (`src/client-coverage.ts`, read from Chrome), but only for a view made with `webview()`:
one made with `new Bun.WebView()` is not measured.
