import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { webview } from "../../../src/webview";
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
      "/api/picture": () => (typeof picture.body === "string" ? new Response(picture.body, { status: picture.status }) : Response.json(picture.body, { status: picture.status })),
    },
  });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with a bare `#root` element and this example's applets registered as `window.applets`. */
async function run(script: string): Promise<unknown> {
  await using view = webview();
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
      // the next render that draws the photo again (someone joins), not only a fade
      window.applets.photo.update(el, { entries: [...entries, { key: "2", spec: ${JSON.stringify(look)} }], label: "x", reveal: true });
      const secondReveal = el.innerHTML.includes("descend");
      return { beforeReveal, firstReveal, secondReveal };
    `);
    expect(result).toEqual({ beforeReveal: false, firstReveal: true, secondReveal: false });
  });

  test("a newcomer stops walking once the walk is over; a figure that opens something opens by Enter or Space, as by a finger", async () => {
    const result = await run(`
      const el = root.appendChild(document.createElement("div"));
      const sent = [];
      const tap = { doc: "household", op: { op: "replace", path: "/open", value: "1" } };
      window.applets.photo.mount(el, { props: { entries: [{ key: "1", spec: ${JSON.stringify(look)}, tap }], label: "x" }, send: (doc, ops) => sent.push(doc) });
      window.applets.photo.update(el, { entries: [{ key: "1", spec: ${JSON.stringify(look)}, tap }, { key: "2", spec: ${JSON.stringify(look)} }], label: "x" });
      const walk = el.querySelector(".walk");
      walk.dispatchEvent(new AnimationEvent("animationend", { animationName: "walk-in", bubbles: true }));
      const figure = el.querySelector('[data-key="1"]');
      figure.focus();
      for (const key of ["Enter", " ", "a"]) figure.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      return [walk.querySelector(".fig").classList.contains("walking"), sent];
    `);
    expect(result).toEqual([false, ["household", "household"]]);
  });
});

describe("dress applet", () => {
  test("a part of the figure opens by Enter and closes by Space, as a finger opens and closes it", async () => {
    const result = await run(`
      const el = root.appendChild(document.createElement("div"));
      window.applets.dress.mount(el, { props: { guestId: 1, spec: ${JSON.stringify(look)}, firstName: "Ada" }, send: () => {} });
      const key = (k) => {
        el.querySelector(".hit-legs").focus();
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        return el.querySelector(".pop-legs") !== null;
      };
      return [key("Enter"), key(" ")];
    `);
    expect(result).toEqual([true, false]);
  });
});

describe("picture-field applet", () => {
  test("a photograph bigger than a screen goes drawn down to 1600px on its long side, as a JPEG; one the browser cannot draw goes as it is", async () => {
    const result = await run(`
      const canvas = Object.assign(document.createElement("canvas"), { width: 2000, height: 1000 });
      canvas.getContext("2d").fillRect(0, 0, 10, 10);
      const png = await new Promise((done) => canvas.toBlob(done, "image/png"));
      const small = await window.downsized(new File([png], "big.png", { type: "image/png" }));
      const { width, height } = await createImageBitmap(small);
      const broken = new File([new Uint8Array([1, 2, 3])], "broken.png", { type: "image/png" });
      return [small.name, small.type, width, height, (await window.downsized(broken)) === broken];
    `);
    expect(result).toEqual(["big.jpg", "image/jpeg", 1600, 800, true]);
  });

  test("its button opens the chooser; a refusal that says nothing says the picture was not kept; a render's new props draw the picture", async () => {
    picture = { status: 500, body: "not json" };
    const result = await run(`
      const el = root.appendChild(document.createElement("div"));
      const props = { doc: "board", path: "/picture_key", current: null };
      window.applets["picture-field"].mount(el, { props, send: () => {} });
      let chooser = 0;
      el.querySelector("input").addEventListener("click", (e) => (chooser++, e.preventDefault()));
      el.querySelector("button").click();

      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], "pic.gif", { type: "image/gif" }));
      const input = el.querySelector("input[type=file]");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const start = Date.now();
      while (["Sending…", undefined].includes(el.querySelector(".note")?.textContent) && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 10));
      const note = el.querySelector(".note")?.textContent;

      window.applets["picture-field"].update(el, { ...props, current: "a.jpg" });
      return [chooser, note, el.querySelector("img").getAttribute("src"), el.querySelector("button").textContent];
    `);
    expect(result).toEqual([1, "The picture was not kept.", "/pictures/a.jpg", "Change picture"]);
  });
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
