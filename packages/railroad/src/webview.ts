/**
 * `@blueshed/railroad/webview`: a page in a real browser, for tests (`bun:test`, Bun.WebView).
 * Test-only: nothing here is for a page or a server, and railroad itself imports none of it.
 *
 *   const server = await startServer({ port: 0 });
 *   const { view, open, waitFor, close } = browser(() => server.url);
 *   test("the page says hello", async () => {
 *     await open();
 *     await waitFor(`document.querySelector("h1")?.textContent === "Hello"`);
 *   });
 *   afterAll(() => close());
 *
 * Bun.WebView (experimental; follow these exactly):
 * - evaluate() takes a string expression, not a function: view.evaluate<string>("document.title").
 *   Wrap statements in an IIFE string. Results come back as JSON; give them a type: evaluate<string>(...).
 * - await every call. A view takes one navigate, evaluate, screenshot or input at a time, or throws ERR_INVALID_STATE.
 * - click(selector) waits until the element is visible, stable and not covered. It does not scroll.
 * - type() appends. To replace a field's text, use replaceText.
 * - view.title is empty after the first navigate on macOS WebKit: read document.title with evaluate.
 * - One view per file: browser(). A test that needs a second window uses withOtherWindow.
 *   browser() makes the first navigation before the file's tests, and open() waits for the last to settle.
 * - macOS uses the system WebKit. Linux needs Chrome, found through BUN_CHROME_PATH.
 */
import { beforeAll } from "bun:test";

/** Polls a page-side expression until it is truthy; throws after `timeout` ms. */
export async function waitIn(view: Bun.WebView, expr: string, timeout = 5_000): Promise<void> {
  const end = performance.now() + timeout; // not Date.now: a test may fix that clock with setSystemTime
  while (performance.now() < end) {
    if (await view.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

const newView = () => new Bun.WebView({ width: 1280, height: 800, console: globalThis.console });

/** A view at the page `url()` names, and the helpers page tests share. `url` is read on each visit, so a test can restart the server on another port. */
export function browser(url: () => URL) {
  const view = newView();
  let visits = 0;

  // One navigation at a time, each after the last has settled: a test cut off while its page
  // loads leaves the next test a page to wait for, not "a navigation is already pending".
  let last: Promise<unknown> = Promise.resolve();
  const navigate = (to: string) => (last = Promise.allSettled([last]).then(() => view.navigate(to)));

  // The browser starts on the first navigation, which CI's Chrome can take more than a test's
  // time over: the file makes it before its tests, with two minutes of its own.
  beforeAll(() => navigate(`${url().href}?warm`), 120_000);

  return {
    view,

    /** Loads the page afresh: each visit gets a query of its own, as navigating to where the view is does not reload it. */
    open: () => navigate(`${url().href}?visit=${++visits}`),

    waitFor: (expr: string, timeout?: number) => waitIn(view, expr, timeout),

    /** Replaces what is in a field the way typing would: clears it (and tells the page), then types. */
    async replaceText(selector: string, text: string) {
      await view.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ""; el.dispatchEvent(new Event("input")); })()`);
      await view.click(selector);
      await view.type(text);
    },

    /** Makes every fetch the page makes from now on answer 500, to see what a person sees when the server says no. */
    failFetch: () => view.evaluate(`window.fetch = async () => new Response(null, { status: 500 })`),

    /** A second window, for the tests that need two: opened at the page, closed in a finally. */
    async withOtherWindow(run: (other: Bun.WebView, waitForOther: (expr: string) => Promise<void>) => Promise<void>) {
      const other = newView();
      try {
        await other.navigate(`${url().href}?other=${++visits}`);
        await run(other, (expr) => waitIn(other, expr));
      } finally {
        other.close();
      }
    },

    close: () => view.close(),
  };
}
