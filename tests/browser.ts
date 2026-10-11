// A Bun.WebView at the app's page, and the helpers page tests share. One per test file.
// The rules for Bun.WebView are at the top of site.test.ts: follow them.

// Poll a page-side expression until it is truthy
async function waitIn(view: Bun.WebView, expr: string, timeout = 5_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await view.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

const newView = () => new Bun.WebView({ width: 1280, height: 800, console: globalThis.console });

/** `url` is read on each visit, so a test can restart the server on another one. */
export function browser(url: () => URL) {
  const view = newView();
  let visits = 0;

  return {
    view,

    // Load the page afresh. Navigating to the URL the view is already at does not reload it,
    // so each visit gets a query of its own (the route ignores it).
    open: () => view.navigate(`${url().href}?visit=${++visits}`),

    waitFor: (expr: string, timeout?: number) => waitIn(view, expr, timeout),

    // Replace what is in a field the way typing would: clear it (and tell the page), then type
    async replaceText(selector: string, text: string) {
      await view.evaluate(`(() => { const el = document.querySelector("${selector}"); el.value = ""; el.dispatchEvent(new Event("input")); })()`);
      await view.click(selector);
      await view.type(text);
    },

    // Make every fetch the page makes from now on answer 500, to see what a person sees when the server says no
    failFetch: () => view.evaluate(`window.fetch = async () => new Response(null, { status: 500 })`),

    // A second window, for the tests that need two: opened at the page, closed in a finally
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
