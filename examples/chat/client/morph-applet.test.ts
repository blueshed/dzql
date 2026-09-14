import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./morph-applet.test.html";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { "/": fixture } });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with a bare `#root` element and morph.ts loaded as `window.morph`. */
async function run(script: string): Promise<unknown> {
  await using view = new Bun.WebView();
  await view.navigate(server.url.toString());

  // The module script still needs a moment to execute after navigate() resolves.
  const start = Date.now();
  while ((await view.evaluate(`typeof window.morph`)) !== "function") {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for window.morph");
    await Bun.sleep(10);
  }

  // `return await`, not `return`: `await using`'s disposal runs as this function
  // returns, and would close the view out from under a still-pending evaluate().
  return await view.evaluate(`(() => { const root = document.querySelector('#root'); ${script} })()`);
}

describe("room-picker mounted against the kernel's morph", () => {
  test("the real room-picker applet's update() reuses the element and preserves the typed filter", async () => {
    const result = await run(`
      const el = document.createElement("div");
      el.dataset.applet = "room-picker";
      root.appendChild(el);

      window.applets["room-picker"].mount(el, { props: { rooms: ["alpha", "beta"] }, send: () => {} });
      const input = el.querySelector("input");
      input.value = "al";
      input.dispatchEvent(new Event("input"));

      window.applets["room-picker"].update(el, { rooms: ["alpha", "gamma"] });

      const suggestions = [...el.querySelectorAll(".room-picker-suggestions li")].map((li) => li.textContent);
      return { inputValue: input.value, suggestions };
    `);
    // "al" still matches "alpha" in the new list; "gamma" is filtered out, same as before the props changed
    expect(result).toEqual({ inputValue: "al", suggestions: ["alpha"] });
  });
});
