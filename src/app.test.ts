import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "./server";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(0);
});

afterAll(() => {
  server.stop(true);
});

async function waitFor(
  view: Bun.WebView,
  script: string,
  predicate: (value: unknown) => boolean,
  timeout = 5000,
): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

const NAME_FORM_VISIBLE = `document.querySelector('[data-event="set-name"]') !== null`;
const USER_LABEL = `document.querySelector('.user-label')?.textContent ?? null`;

async function submitName(view: Bun.WebView, name: string) {
  await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  await view.click("#name");
  await view.type(name);
  await view.click("button[type=submit]");
}

describe("app.ts in a real browser", () => {
  test("a fresh session shows the name form, then the user bar after submitting", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Ada");

    const label = await waitFor(view, USER_LABEL, (v) => v === "Ada");
    expect(label).toBe("Ada");
  });

  test("the session survives a reload via the session cookie", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Grace");
    await waitFor(view, USER_LABEL, (v) => v === "Grace");

    await view.reload();

    const label = await waitFor(view, USER_LABEL, (v) => v === "Grace");
    expect(label).toBe("Grace");
  });

  test("logout clears the session and shows the name form again", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());

    await submitName(view, "Linus");
    await waitFor(view, USER_LABEL, (v) => v === "Linus");

    await view.click("[data-event=logout]");

    await waitFor(view, NAME_FORM_VISIBLE, (v) => v === true);
  });
});
