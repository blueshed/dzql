// The client's coverage (todo n15), bun test's preload. bun's table holds only what a test loads in
// its own process, and the client runs in a page. So every view is Chrome (src/webview.ts), whose
// DevTools count what a page ran, block by block, and a bundle's source map takes each count back to
// its file and line. A file a page ran that bun's table does not hold -- not a package's, not a
// test's, not one a test loads itself -- is held to the same bar at the end of the run: every line
// ran, and every function was called. A page's counts go with it, so they are read before a view
// goes somewhere else and before it closes.

import { afterAll, expect } from "bun:test";
import { dirname, relative } from "node:path";
import { measured } from "./webview";

type Range = { startOffset: number; endOffset: number; count: number };
/** What DevTools say of one script a page ran (`Profiler.takePreciseCoverage`): each function's ranges, the function's own first. */
export type Script = { url: string; functions: { ranges: Range[] }[] };
/** A bundle, as the page ran it: its text, and of each point its source map names, the offset, the file and the line (from 1). */
type Bundle = { text: string; points: [offset: number, file: string, line: number][] };
/** Of each file a page ran: each line a bundle maps to it, and whether it ran. */
export type Ran = Map<string, Map<number, boolean>>;

const root = dirname(import.meta.dir);
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A source map's points, in the order of the bundle: [generated line, generated column, source, source line], each from 0. */
export function decode(mappings: string): number[][] {
  const points: number[][] = [];
  let [source, line] = [0, 0];
  mappings.split(";").forEach((row, at) => {
    let column = 0;
    for (const segment of row.split(",")) {
      const v: number[] = [];
      let [n, shift] = [0, 0];
      for (const ch of segment) {
        const d = B64.indexOf(ch);
        n += (d & 31) << shift;
        shift += 5;
        if (d & 32) continue;
        v.push(n & 1 ? -(n >> 1) : n >> 1);
        [n, shift] = [0, 0];
      }
      column += v[0] ?? 0;
      if (v.length < 4) continue; // an empty row, or a point with no source
      [source, line] = [source + v[1]!, line + v[2]!];
      points.push([at, column, source, line]);
    }
  });
  return points;
}

/** A bundle as `text` and its source map make it. */
export function bundle(text: string, map: { sources: string[]; mappings: string }): Bundle {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return { text, points: decode(map.mappings).map(([row, column, source, line]) => [starts[row]! + column!, map.sources[source!]!, line! + 1]) };
}

/**
 * Adds what one page ran of `bundle` to `into`. Each point counts as the innermost range over it;
 * a line ran if a point on it did, unless a function that starts on it was never called.
 */
export function count({ text, points }: Bundle, functions: Script["functions"], into: Ran): void {
  const counts = new Int32Array(text.length);
  for (const r of functions.flatMap((f) => f.ranges).sort((a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset))) counts.fill(r.count, r.startOffset, r.endOffset);
  const uncalled = functions.map((f) => f.ranges[0]!).filter((r) => r.count === 0).sort((a, b) => a.startOffset - b.startOffset);
  // of each line here: 1 if a point on it ran, 0 if none did, -1 if a function that starts on it was never called
  const here = new Map<string, Map<number, number>>();
  let u = 0;
  for (const [offset, file, line] of points) {
    let called = true;
    for (; u < uncalled.length && uncalled[u]!.startOffset <= offset; u++) called &&= offset >= uncalled[u]!.endOffset; // the first point of one
    const lines = here.get(file) ?? here.set(file, new Map()).get(file)!;
    const was = lines.get(line) ?? 0;
    lines.set(line, !called || was < 0 ? -1 : counts[offset]! > 0 ? 1 : was);
  }
  for (const [file, lines] of here) {
    const all = into.get(file) ?? into.set(file, new Map()).get(file)!;
    for (const [line, ran] of lines) all.set(line, all.get(line) === true || ran > 0);
  }
}

/** A file this check holds: the app's own code, not a package's or a test's, and not one bun's own table holds. */
export const judged = (file: string, loaded: string[] = Object.keys(require.cache)): boolean =>
  file.startsWith(`file://${root}/`) && /\.tsx?$/.test(file) && !/\/node_modules\/|\.test[.-]/.test(file) && !loaded.includes(Bun.fileURLToPath(file));

/** Lines as runs, as bun's table says them: "12, 40-42". */
export function spans(lines: number[]): string {
  const runs: number[][] = [];
  for (const n of [...lines].sort((a, b) => a - b)) {
    if (runs.at(-1)?.at(-1) === n - 1) runs.at(-1)!.push(n);
    else runs.push([n]);
  }
  return runs.map((r) => (r.length > 1 ? `${r[0]}-${r.at(-1)}` : `${r[0]}`)).join(", ");
}

/** Each judged file with a line that never ran, and those lines: "src/client/morph.ts: 12, 40-42". */
export function gaps(ran: Ran, judge: (file: string) => boolean = judged): string[] {
  const missed = [...ran].filter(([file]) => judge(file)).map(([file, lines]) => [file, [...lines].filter(([, r]) => !r).map(([n]) => n)] as const);
  return missed.filter(([, lines]) => lines.length > 0).map(([file, lines]) => `${relative(root, Bun.fileURLToPath(file))}: ${spans(lines)}`).sort();
}

const ran: Ran = new Map();
const bundles = new Map<string, Promise<Bundle>>();
const started = new WeakSet<Bun.WebView>();
const pending: Promise<void>[] = [];

/** A bundle the page was sent, and its map, fetched again from its server. A view's own host (`view1.localhost`) is this machine. */
async function load(url: string): Promise<Bundle> {
  const at = Object.assign(new URL(url), { hostname: "127.0.0.1" });
  const text = await (await fetch(at)).text();
  const map = await (await fetch(new URL(/\/\/# sourceMappingURL=(\S+)\s*$/.exec(text)![1]!, at))).json();
  return bundle(text, map);
}

/** A bundle, loaded once a URL. */
function fetched(url: string): Promise<Bundle> {
  if (!bundles.has(url)) bundles.set(url, load(url));
  return bundles.get(url)!;
}

/** What the page in `view` ran since it was last read, added to `into`: the run's, unless a test reads it apart. */
export async function read(view: Bun.WebView, into: Ran = ran): Promise<void> {
  const { result } = await view.cdp<{ result: Script[] }>("Profiler.takePreciseCoverage");
  for (const script of result.filter((s) => s.url.includes("/_bun/client/"))) count(await fetched(script.url), script.functions, into);
}

const P = Bun.WebView.prototype;
const { navigate, close } = P;
/** Before a test's view goes anywhere: counting begins, on a blank page, before its first; else what the page it leaves ran is read. */
async function leaving(view: Bun.WebView): Promise<void> {
  if (!measured(view)) return; // by hand's, on WebKit
  if (started.has(view)) return read(view);
  started.add(view);
  await navigate.call(view, "about:blank");
  await view.cdp("Profiler.enable");
  await view.cdp("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
}
/** A view closes once what its page ran is read. */
async function closing(view: Bun.WebView): Promise<void> {
  try {
    if (started.has(view)) await read(view);
  } finally {
    close.call(view);
  }
}

for (const name of ["navigate", "reload", "goBack", "goForward"] as const) {
  const go = P[name] as (this: Bun.WebView, ...args: unknown[]) => Promise<void>;
  P[name] = async function (this: Bun.WebView, ...args: unknown[]) {
    await leaving(this);
    return go.apply(this, args);
  };
}
P.close = function () {
  pending.push(closing(this));
};
Object.defineProperty(P, Symbol.dispose, { value: P.close });
Object.defineProperty(P, Symbol.asyncDispose, {
  value(this: Bun.WebView) {
    return closing(this);
  },
});

afterAll(async () => {
  await Promise.all(pending);
  console.log(`src/client-coverage.ts: ${[...ran.keys()].filter((file) => judged(file)).length} files a page ran, beside bun's table, held to it`);
  expect(gaps(ran), "a line of the client no page ran (src/client-coverage.ts)").toEqual([]);
});
