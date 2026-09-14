import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./applets.test.html";

// A 1x1 transparent PNG, small enough that downsized() takes its "already small" shortcut
// regardless of whether this WebView's engine supports createImageBitmap -- either way the same
// bytes go out, so the test doesn't depend on that support existing.
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let server: ReturnType<typeof Bun.serve>;
// The stub /api/picture this harness's own server answers with -- swapped per test, since
// picture-field.ts itself doesn't know or care what's behind that route.
let picture: { status: number; body: unknown } = { status: 200, body: { key: "ok.jpg" } };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/": fixture,
      "/api/picture": () => Response.json(picture.body, { status: picture.status }),
    },
  });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with a bare `#root` element and this example's applets registered as `window.applets`. */
async function run(script: string): Promise<unknown> {
  await using view = new Bun.WebView();
  await view.navigate(server.url.toString());

  const start = Date.now();
  while ((await view.evaluate(`typeof window.applets`)) !== "object") {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for window.applets");
    await Bun.sleep(10);
  }

  // `return await`, not `return`: `await using`'s disposal runs as this function returns, and
  // would close the view out from under a still-pending evaluate().
  return await view.evaluate(`(async () => { const root = document.querySelector('#root'); ${script} })()`);
}

const look = { skin: "#F2C86A", hair: "bob", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "smile", attitude: "nodding" };

describe("photo applet's update()", () => {
  test("a newcomer walks in; an entry already there on the last render doesn't", async () => {
    const walking = await run(`
      const el = document.createElement("div");
      el.dataset.applet = "photo";
      root.appendChild(el);
      window.applets.photo.mount(el, { props: { entries: [{ key: "1", spec: ${JSON.stringify(look)} }], label: "x" }, send: () => {} });
      window.applets.photo.update(el, { entries: [{ key: "1", spec: ${JSON.stringify(look)} }, { key: "2", spec: ${JSON.stringify(look)} }], label: "x" });
      return [...el.querySelectorAll(".slot")].map((g) => g.querySelector(".fig")?.classList.contains("walking") ?? false);
    `);
    expect(walking).toEqual([false, true]);
  });

  test("the names descend the first render reveal turns on, not again on the next", async () => {
    const result = await run(`
      const el = document.createElement("div");
      el.dataset.applet = "photo";
      root.appendChild(el);
      const entries = [{ key: "1", spec: { ...${JSON.stringify(look)}, name: "Ada" } }];
      window.applets.photo.mount(el, { props: { entries, label: "x", reveal: false }, send: () => {} });
      const beforeReveal = el.innerHTML.includes("descend");
      window.applets.photo.update(el, { entries, label: "x", reveal: true });
      const firstReveal = el.innerHTML.includes("descend");
      window.applets.photo.update(el, { entries, label: "x", reveal: true });
      const secondReveal = el.innerHTML.includes("descend");
      return { beforeReveal, firstReveal, secondReveal };
    `);
    expect(result).toEqual({ beforeReveal: false, firstReveal: true, secondReveal: false });
  });
});

describe("picture-field applet", () => {
  test("choosing a picture sends it downsized, and writes the key the route hands back", async () => {
    picture = { status: 200, body: { key: "new.jpg" } };
    const sent = await run(`
      const el = document.createElement("div");
      el.dataset.applet = "picture-field";
      root.appendChild(el);
      let sent;
      window.applets["picture-field"].mount(el, { props: { doc: "board", path: "/picture_key", current: null }, send: (doc, ops) => { sent = { doc, ops }; } });

      const bytes = Uint8Array.from(atob("${TINY_PNG}"), (c) => c.charCodeAt(0));
      const file = new File([bytes], "pic.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = el.querySelector("input[type=file]");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const start = Date.now();
      while (!sent && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 10));
      return sent;
    `);
    expect(sent).toEqual({ doc: "board", ops: [{ op: "replace", path: "/picture_key", value: "new.jpg" }] });
  });

  test("a refusal from the route shows its reason; losing the network shows this applet's own", async () => {
    picture = { status: 413, body: { error: "8MB at most" } };
    const result = await run(`
      const el = document.createElement("div");
      el.dataset.applet = "picture-field";
      root.appendChild(el);
      window.applets["picture-field"].mount(el, { props: { doc: "board", path: "/picture_key", current: null }, send: () => {} });

      const bytes = Uint8Array.from(atob("${TINY_PNG}"), (c) => c.charCodeAt(0));
      function choose() {
        const file = new File([bytes], "pic.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = el.querySelector("input[type=file]");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // "Sending…" is drawn synchronously before the route answers -- wait past it (and past
      // whatever the previous call settled on) for the note the response actually produces.
      async function noteSettles(prev) {
        const start = Date.now();
        let text = el.querySelector(".note")?.textContent ?? null;
        while ((text === null || text === "Sending…" || text === prev) && Date.now() - start < 5000) {
          await new Promise((r) => setTimeout(r, 10));
          text = el.querySelector(".note")?.textContent ?? null;
        }
        return text;
      }

      choose();
      const refused = await noteSettles(null);

      window.fetch = () => Promise.reject(new Error("offline"));
      choose();
      const offline = await noteSettles(refused);

      return { refused, offline };
    `);
    expect(result).toEqual({ refused: "8MB at most", offline: "Could not reach the site." });
  });
});
