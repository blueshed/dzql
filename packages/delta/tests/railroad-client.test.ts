/**
 * railroad ↔ delta integration — the full loop, end to end:
 *
 *   Bun.serve (createWs + the JSON file's registerDocs)
 *     ⇅ real WebSocket
 *   connectWs + openDoc (railroad signals)
 *     ⇅ mount / when / list (railroad real-DOM JSX runtime, happy-dom)
 *
 * Pins the seams that unit tests on either side cannot see:
 *   - a FIELD-LEVEL op edits a keyed list() row (told as the field; the
 *     client freshens the row it lands in → default Object.is notifies)
 *   - one flush per broadcast (batch() around data + dataVersion)
 *   - openDoc dedupe/refcount and doc.close() unregistration
 *   - scope-aware auto-close inside a railroad dispose scope, an effect run included
 *   - late provide(WS): register-on-send self-heal
 *
 * happy-dom supplies the DOM; its WebSocket stub is swapped back for Bun's
 * native client so the socket is real.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const NativeWebSocket = globalThis.WebSocket;
GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.WebSocket = NativeWebSocket;

import {
  effect, mount, when, list, signal,
  provide, clearProviders, setLogLevel as railroadLogLevel, hasActiveDisposeScope,
} from "@blueshed/railroad";
import { connectWs, openDoc, WS, type Doc, type WsClient } from "../src/client/client";
import { createWs } from "../src/server/server";
import { defineDoc, defineSchema, registerDocs } from "../src/server/json";
import { setLogLevel as serverLogLevel } from "../src/server/logger";
import { mockClient, sendAndAwait } from "../src/testing";
import type { DeltaOp } from "../src/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

railroadLogLevel("silent");
serverLogLevel("silent");

interface Card { id: number; title: string }
interface BoardDoc { boards: { id: number; name: string | null }; cards: Record<string, Card> }

// A board and its cards, kept in a JSON file: each test has a board of its own.
const schema = defineSchema({
  boards: { columns: { name: "text?" }, temporal: false },
  cards: { parent: "boards", columns: { title: "text" }, temporal: false },
});
const board = defineDoc("board:", { root: "boards", include: ["cards"], implied: true });
const dir = mkdtempSync(join(tmpdir(), "delta-railroad-it-"));

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("until(): timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// --- one real server + one real client for the whole suite -----------------

const wsrv = createWs();
registerDocs(wsrv, join(dir, "boards.json"), schema, [board]);

/** `doc` as the server has it, opened by someone else. */
async function served(doc: string): Promise<BoardDoc> {
  return (await sendAndAwait(wsrv, mockClient(), { action: "open", doc })).result;
}

/** Someone else writes `ops` to `doc` (opening it first, as a writer does): the server's side of the loop. */
async function elsewhere(doc: string, ops: DeltaOp[]): Promise<void> {
  const other = mockClient();
  await sendAndAwait(wsrv, other, { action: "open", doc });
  expect((await sendAndAwait(wsrv, other, { action: "delta", doc, ops })).error).toBeUndefined();
}

const server = Bun.serve({
  port: 0,
  fetch(req, srv) {
    if (new URL(req.url).pathname === wsrv.path) return wsrv.upgrade(req, srv);
    return new Response("ok");
  },
  websocket: wsrv.websocket,
});
wsrv.setServer(server);

const client: WsClient = connectWs(`http://localhost:${server.port}/ws`);

afterAll(async () => {
  client.close();
  // the socket's close event arrives later: happy-dom must still be registered when it is dispatched
  await until(() => !client.connected.peek());
  server.stop(true);
  clearProviders();
  rmSync(dir, { recursive: true, force: true });
  GlobalRegistrator.unregister();
});

// ---------------------------------------------------------------------------

describe("railroad ↔ delta", () => {
  test("full loop: open → render → add / FIELD-LEVEL edit / remove → DOM", async () => {
    const doc: Doc<BoardDoc> = openDoc("board:1", client);

    const root = document.createElement("div");
    document.body.appendChild(root);
    const cards$ = doc.data.map((d) => (d ? Object.values(d.cards) : []));
    const dispose = mount(root, () =>
      when(doc.data, () =>
        list(cards$, (c) => c.id, (c$) => {
          const li = document.createElement("li");
          effect(() => { li.textContent = c$.get().title; });
          return li;
        }),
      () => {
        const p = document.createElement("p");
        p.textContent = "loading";
        return p;
      }),
    );

    await doc.ready;
    await until(() => !root.textContent?.includes("loading"));

    // Someone else's add renders a row.
    await elsewhere("board:1", [{ op: "add", path: "/cards/5", value: { title: "first" } }]);
    await until(() => root.textContent === "first");

    // THE headline seam: a field-level op, told as the field. The client gives
    // the row it lands in a fresh reference, and keyed list() sees it under
    // its DEFAULT equality — the row's DOM updates.
    await elsewhere("board:1", [{ op: "replace", path: "/cards/5/title", value: "edited" }]);
    await until(() => root.textContent === "edited");

    // Client round trip: send an op, the echo broadcast renders it.
    await doc.send([{ op: "add", path: "/cards/9", value: { title: "nine" } }]);
    await until(() => root.textContent === "editednine");
    expect((await served("board:1")).cards["9"]!.title).toBe("nine");

    // Removal tears the row out.
    await elsewhere("board:1", [{ op: "remove", path: "/cards/5" }]);
    await until(() => root.textContent === "nine");

    dispose();
    doc.close();
    root.remove();
  });

  test("one flush per broadcast: an effect reading data + dataVersion runs once", async () => {
    const doc: Doc<BoardDoc> = openDoc("board:2", client);
    await doc.ready;

    let runs = 0;
    const stop = effect(() => {
      doc.data.get();
      doc.dataVersion.get();
      runs++;
    });
    expect(runs).toBe(1);

    await elsewhere("board:2", [{ op: "add", path: "/cards/-", value: { title: "x" } }]);
    await until(() => runs >= 2);
    // batch() coalesces the dataVersion.set + data.touch pair — without it
    // this effect would run twice per broadcast (runs === 3).
    expect(runs).toBe(2);

    stop();
    doc.close();
  });

  test("openDoc dedupes by name; close() unregisters at refcount zero", async () => {
    const d1: Doc<BoardDoc> = openDoc("board:3", client);
    const d2: Doc<BoardDoc> = openDoc("board:3", client);

    // Same underlying entry — the same signals, not a second dead copy.
    expect(d2.data).toBe(d1.data);
    expect(client._docs.has("board:3")).toBe(true);

    d1.close();
    d1.close(); // per-handle idempotent
    expect(client._docs.has("board:3")).toBe(true); // d2 still live

    d2.close();
    expect(client._docs.has("board:3")).toBe(false);
  });

  test("a doc opened inside a railroad scope closes on scope teardown", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const dispose = mount(root, () => {
      openDoc("board:4", client);
      return document.createElement("span");
    });
    expect(client._docs.has("board:4")).toBe(true);

    dispose();
    expect(client._docs.has("board:4")).toBe(false);
    root.remove();
  });

  // railroad 0.12 makes every effect()/computed() run a scope of its own: what a run creates is
  // disposed before the next. An openDoc in an effect body is therefore closed and re-opened on
  // every re-run -- the reference says to open in the component or at module level instead.
  test("a doc opened inside an effect() body closes when the effect runs again, and when it stops", () => {
    const which = signal("a");
    const stop = effect(() => {
      openDoc(`it:effect-${which.get()}`, client);
    });
    expect(client._docs.has("it:effect-a")).toBe(true);

    which.set("b");
    expect(client._docs.has("it:effect-a")).toBe(false); // the run that opened it is over
    expect(client._docs.has("it:effect-b")).toBe(true);

    stop();
    expect(client._docs.has("it:effect-b")).toBe(false);
  });

  test("late provide(WS): a parked doc self-heals on first send()", async () => {
    clearProviders();
    const doc: Doc<BoardDoc> = openDoc("board:5"); // no client, WS not provided
    await new Promise((r) => queueMicrotask(() => r(undefined))); // deferred registration finds nothing

    provide(WS, client);
    await doc.send([{ op: "add", path: "/cards/-", value: { title: "late" } }]);

    await doc.ready; // register-on-send opened the doc
    await until(() => Object.values(doc.data.peek()?.cards ?? {}).some((c) => c.title === "late"));
    doc.close();
    clearProviders();
  });
  // railroad 0.11.0 makes async components a supported shape (resolve to a
  // thunk). There is no dispose scope after an `await` — browser JS has no
  // AsyncContext to carry one across suspension — so an openDoc past the first
  // await never auto-closes, while one inside the thunk does. The skill's
  // reference documents that rule; this pins the mechanism it rests on.
  test("no dispose scope survives an await; the thunk gets a fresh one", async () => {
    const seen: Record<string, boolean> = {};
    const root = document.createElement("div");
    document.body.appendChild(root);

    let settle!: () => void;
    const reached = new Promise<void>((r) => { settle = r; });

    const dispose = mount(root, () => {
      seen.sync = hasActiveDisposeScope();
      void (async () => {
        await Promise.resolve();
        seen.afterAwait = hasActiveDisposeScope();
        settle();
      })();
      return document.createElement("div");
    });

    await reached;
    dispose();
    root.remove();

    expect(seen.sync).toBe(true);        // synchronous body IS owned
    expect(seen.afterAwait).toBe(false); // post-await is NOT — hence the thunk rule
  });
});
