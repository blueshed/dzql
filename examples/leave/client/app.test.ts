import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { at, waitFor } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { example } from "../index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

describe("leave in a real browser", () => {
  test("the sign-in page posts as a plain form, the password never on the socket, and Ann is on her box", async () => {
    await using view = new Bun.WebView();
    await view.navigate(at(view, server.url));
    await waitFor(view, `document.querySelector('form.sign-in') !== null`, (v) => v === true);
    await view.click("input[name=email]");
    await view.type("ann@leave.example");
    await view.click("input[name=password]");
    await view.type("ann-password");
    await view.evaluate(`document.querySelector('form.sign-in').requestSubmit()`);
    await waitFor(view, `document.querySelector('.cell[data-key="mine"]') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('.cell[data-key="team"]').textContent`)).toContain("the team");
    // the new page's socket has carried no password: it went to /login alone
    expect(await view.evaluate<boolean>(`JSON.stringify(window.eta.docs()).includes("ann-password")`)).toBe(false);
  }, 15000);
});
