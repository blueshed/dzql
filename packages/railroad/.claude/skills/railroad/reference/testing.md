# Testing

```tsx
// counter.test.tsx: happy-dom preloaded, as below
import { test, expect } from "bun:test";
import { signal, mount, routes, navigate } from "@blueshed/railroad";

test("a click counts", () => {
  const count = signal(0);
  const root = document.createElement("div");
  const dispose = mount(root, () => <button onclick={() => count.update((n) => n + 1)}>{count}</button>);
  root.querySelector("button")!.click();
  expect(root.textContent).toBe("1");
  dispose();
});

test("navigate() needs no tick", () => {
  const root = document.createElement("div");
  const dispose = routes(root, { "/": () => <p>home</p>, "/about": () => <p>about</p> });
  navigate("/about");
  expect(root.textContent).toBe("about");
  dispose();
});
```

```ts
// happy-dom.setup.ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

```sh
bun add -d @types/bun @happy-dom/global-registrator   # bun:test's types, and the DOM
```

```toml
# bunfig.toml: preloaded by every bun test
[test]
preload = ["./happy-dom.setup.ts"]
```

Where `bunfig.toml` cannot be written, put the preload in package.json's `test` script,
`"test": "bun test --preload ./happy-dom.setup.ts"`, and run it with `bun run test`. A bare
`bun test` then has no DOM: `document is not defined`.

Working: [examples/jobs/tests/jobs.test.tsx](https://github.com/blueshed/dzql/blob/main/packages/railroad/examples/jobs/tests/jobs.test.tsx),
which mounts each test under a scope of its own, asserts straight after a click, waits a macrotask
for a hash set by hand and clears the providers, on happy-dom preloaded by the example's
`bunfig.toml`; railroad's `tests/webview-examples.test.ts` runs the app in a real browser.

- Unit tests run on happy-dom for fast reactivity checks; `mount()` gives each test a scope to dispose.
- Writes notify synchronously: assert straight after a `.set()` or a click.
- Setting `location.hash` yourself, or a `#/…` link, lands on the next `hashchange`, a macrotask: `await new Promise((r) => setTimeout(r, 0))`.
- `clearProviders()` resets `provide`/`inject` between tests.
- Real-browser tests use `Bun.WebView` against the real `Bun.serve`: the `bun-route` skill has the server factory, the patterns and the footguns.
- Keep browser tests in their own file and run them by explicit path too: with no browser found they skip with a warning, so a green bare `bun test` doesn't prove they ran.
