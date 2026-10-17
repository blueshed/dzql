import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor, webview } from "dzql/rendering/webview";
import fixture from "./applets.test.html";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { "/": fixture } });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with a bare `#root` element and the ticker's applets registered as `window.applets`. */
async function run(script: string): Promise<unknown> {
  await using view = webview();
  await view.navigate(server.url.toString());
  await waitFor(view, `typeof window.applets`, (v) => v === "object");
  // `return await`: the view closes as this returns, and would close under a pending evaluate()
  return await view.evaluate(`(async () => { const root = document.querySelector('#root'); ${script} })()`);
}

describe("the ticker's applets, as the kernel's client drives them", () => {
  test("a board row given new props by a render draws them, the prices it has seen kept", async () => {
    const result = await run(`
      const el = root.appendChild(document.createElement("div"));
      const row = (price, prev) => ({ symbol: "FXTR", quote: { name: "Foxtrot", price, prev } });
      window.applets.board.mount(el, { props: row(10, 9), send: () => {} });
      window.applets.board.update(el, row(12, 10));
      return [el.querySelector(".price").textContent, el.querySelector("polyline").getAttribute("points").split(" ").length];
    `);
    expect(result).toEqual(["12.00", 2]);
  });

  test("a clock follows the zone a render gives it, and stops when it is taken off the page, sweeping or turning once a second", async () => {
    const result = await run(`
      const hour = (el) => el.querySelector(".hand.hour").getAttribute("transform");
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const stops = [];
      for (const still of [false, true]) {
        window.matchMedia = (q) => ({ matches: still && q.includes("reduced-motion") });
        const el = root.appendChild(document.createElement("div"));
        const stop = window.applets.clock.mount(el, { props: { tz: "UTC" }, send: () => {} });
        const utc = hour(el);
        window.applets.clock.update(el, { tz: "Asia/Kolkata" }); // five and a half hours on
        await new Promise((done) => setTimeout(done, still ? 1100 : 50));
        const moved = hour(el) !== utc;
        stop();
        el.querySelector(".hand.hour").setAttribute("transform", "stopped");
        await new Promise((done) => setTimeout(done, still ? 1100 : 50));
        await frame();
        stops.push([moved, hour(el)]);
      }
      return stops;
    `);
    expect(result).toEqual([
      [true, "stopped"],
      [true, "stopped"],
    ]);
  }, 10000);
});
