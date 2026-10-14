import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import { bundle, count, decode, gaps, judged, read, spans, type Ran } from "./client-coverage";
import fixture from "./client/morph.test.html";
import { waitFor, webview } from "./webview";

// The client in bun test's coverage gate (todo n15): what a page ran, read from Chrome, by file and line.

const root = Bun.pathToFileURL(dirname(import.meta.dir)).href;

describe("the client's coverage", () => {
  test("a builder breaks the client's morph -- a line of it no page runs -- and bun test's gate names it, by file and line", async () => {
    const server = Bun.serve({ port: 0, routes: { "/": fixture } });
    try {
      await using view = webview();
      await view.navigate(server.url.toString());
      await waitFor(view, `typeof window.morph`, (v) => v === "function");
      const at = (await Bun.file(`${import.meta.dir}/client/morph.ts`).text()).split("\n").findIndex((line) => line.startsWith("export function morph(")) + 1;
      const ran: Ran = new Map();
      await read(view, ran); // morph.ts loaded, and morph never called
      expect(ran.get(`${root}/src/client/morph.ts`)?.get(at)).toBe(false);
      expect(gaps(ran).find((gap) => gap.startsWith("src/client/morph.ts: "))).toContain(`${at}`);
      await view.evaluate(`(window.morph(document.querySelector('#root'), '<p>called</p>'), 1)`);
      await read(view, ran);
      expect(ran.get(`${root}/src/client/morph.ts`)?.get(at)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("a source map's points, each a line and column of the bundle and of its source, as deltas in base 64", () => {
    // a point, an empty line, two points on one line; a point with no source; one past a digit's five bits
    expect(decode("AAAA;;AACA,CAAC")).toEqual([
      [0, 0, 0, 0],
      [2, 0, 0, 1],
      [2, 1, 0, 1],
    ]);
    expect(decode("AAAA,C;AAgBA")).toEqual([
      [0, 0, 0, 0],
      [1, 0, 0, 16],
    ]);
  });

  test("a line ran if a point on it did, unless a function that starts on it was never called; a line any page ran, ran", () => {
    const map = { sources: ["file:///x.ts"], mappings: "AAAA,CAAA;AACA" }; // "xy" is line 1, "z" line 2
    const top = { ranges: [{ startOffset: 0, endOffset: 4, count: 1 }] };
    const ran: Ran = new Map();
    count(bundle("xy\nz", map), [top, { ranges: [{ startOffset: 1, endOffset: 2, count: 0 }] }], ran); // y, a function never called
    expect([...ran.get("file:///x.ts")!]).toEqual([
      [1, false],
      [2, true],
    ]);
    count(bundle("xy\nz", map), [top, { ranges: [{ startOffset: 1, endOffset: 2, count: 1 }] }], ran); // another page called it
    expect([...ran.get("file:///x.ts")!]).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  test("it holds the app's own code that bun's table does not: not a package's, a test's, a page's HTML, or a file a test loads", () => {
    const own = `${root}/src/client/morph.ts`;
    expect(judged(own, [])).toBe(true);
    expect(judged(own, [Bun.fileURLToPath(own)])).toBe(false);
    for (const file of [`${root}/node_modules/@blueshed/railroad/jsx.ts`, `${root}/src/client/app.test.entry.ts`, `${root}/src/client/app.test.html`, "bun://Bun/Bun HMR Runtime"]) expect(judged(file, [])).toBe(false);
  });

  test("the lines no page ran are said as bun's table says them, a file a line", () => {
    expect(spans([42, 12, 40, 41])).toBe("12, 40-42");
    const ran: Ran = new Map([
      [`${root}/src/b.ts`, new Map([[3, false]])],
      [`${root}/src/a.ts`, new Map([[1, true], [2, false]])],
      [`${root}/src/c.ts`, new Map([[1, true]])],
    ]);
    expect(gaps(ran, () => true)).toEqual(["src/a.ts: 2", "src/b.ts: 3"]);
  });
});
