import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { serve } from "@blueshed/delta/serve";
import { appOf, createServer } from "dzql/rendering/server";
import { heard, open, pageOf, write } from "dzql/rendering/test-socket";
import { app, store } from "./store.test.app";

// An app's store is open only while a server holds it: `appOf` opens it as the server starts and
// closes it as the server stops, so servers run one after another in one process, and `bun --hot`
// closes the last store before the app, run again, opens the next.

setDefaultTimeout(60_000);

const scratch = mkdtempSync(`${tmpdir()}/store-`);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The ids of the notes a page shows. */
const ids = (page: string) => [...page.matchAll(/<li id="n(\d+)">/g)].map(([, id]) => Number(id));

/** A note added from a page, and the ids that page then shows. */
async function added(server: { url: URL | string }): Promise<number[]> {
  const ws = await open(server);
  write(ws, "notes", [{ op: "add", path: "/notes/-", value: { text: "a note" } }]);
  await heard(ws);
  const shown = ids(pageOf(ws));
  ws.close();
  return shown;
}

test("a server opens the app's store as it starts and closes it as it stops; the next server opens it afresh", async () => {
  await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
  for (const _ of [1, 2]) {
    const server = await createServer(app, 0);
    expect(await added(server)).toEqual([1]); // in memory: each open a new database
    await server.stop(true);
    await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
  }
});

test("servers on data folders of their own, one after another in one process: each folder keeps its own notes; two at once share one folder or are refused", async () => {
  const on = async (dataDir: string) => serve(await appOf(app, { dataDir }), { port: 0, dev: false });
  const [first, second] = [`${scratch}/first`, `${scratch}/second`]; // not there yet, as on a new app's first start
  for (const [dataDir, then] of [[first, [1]], [second, [1]], [first, [1, 2]]] as const) {
    const server = await on(dataDir);
    expect(await added(server)).toEqual([...then]);
    await server.stop(true);
  }
  const held = await on(first);
  await expect(appOf(app, { dataDir: second })).rejects.toThrow(`The store is open on ${first}/pg: a second server cannot open it on ${second}/pg`);
  const again = await on(first); // the same folder: the same store, held twice
  await again.stop(true);
  expect(await added(held)).toEqual([1, 2, 3]);
  await held.stop(true);
});

test("bun --hot: the last store is closed before the app, run again, opens the next, so its ids carry on, 1 then 2", async () => {
  const fixture = `${import.meta.dir}/store.test.app.ts`;
  const proc = Bun.spawn([process.execPath, "--hot", fixture], {
    env: { ...process.env, PORT: "0", PID_FILE: `${scratch}/.server.pid`, DATA_PATH: scratch, DATABASE_URL: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  let out = "";
  /** The url the server says it listens on, the next time it says so. */
  const listening = async (): Promise<string> => {
    const from = out.length;
    for (;;) {
      const said = out.slice(from).match(/Listening on (\S+)/);
      if (said) return said[1]!;
      const { value, done } = await reader.read();
      if (done) throw new Error(`The server exited:\n${out}${await new Response(proc.stderr).text()}`);
      out += new TextDecoder().decode(value);
    }
  };
  try {
    const url = await listening();
    expect(await added({ url })).toEqual([1]);
    await Bun.write(fixture, await Bun.file(fixture).text()); // a save: the app runs again, in the same process
    expect(await listening()).toBe(url);
    expect(await added({ url })).toEqual([1, 2]); // the folder closed cleanly: none of the ids PGlite set aside skipped
  } finally {
    proc.kill();
    await proc.exited;
  }
});
