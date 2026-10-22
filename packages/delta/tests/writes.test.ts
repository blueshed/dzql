/**
 * What every backend answers alike about a write (`src/cases/writes.ts`,
 * published in `@blueshed/delta/testing`): the error table (D11), a row the
 * server names (D3), and write scope -- on SQLite and the JSON file (dzql asks
 * them of Postgres). Beside them, what
 * the protocol answers itself, and the memory document, which is not on the
 * moving-on path.
 */
import { describe, test, expect } from "bun:test";
import { createWs } from "../src/server/server";
import { registerMemory } from "../src/server/kinds";
import { setLogLevel } from "../src/server/logger";
import { columnTypeCases, rangeScopeCases, acceptCases, shapeCases, refsCases, cursorCases, serverTimeCases, createRowCases, errorCodeCases, mockClient, refusalCases, sendAndAwait, uniqueCases, writeScopeCases } from "@blueshed/delta/testing";
import { jsonBackend, sqliteBackend } from "./helpers/case-backends";

setLogLevel("silent");

for (const [name, backend] of [["SQLite", sqliteBackend], ["the JSON file", jsonBackend]] as const) {
  describe(name, () => {
    errorCodeCases(backend);
    refusalCases(backend);
    createRowCases(backend);
    writeScopeCases(backend);
    uniqueCases(backend);
    acceptCases(backend);
    shapeCases(backend);
    refsCases(backend);
    serverTimeCases(backend);
    cursorCases(backend);
    columnTypeCases(backend);
    rangeScopeCases(backend);
  });
}

describe("the protocol's own answers", () => {
  test("a doc no backend owns is 404, an unknown action 400, a private method 403", async () => {
    const ws = createWs();
    ws.on("open", (msg, _c, respond) => { if (msg.doc === "chat:room") respond({ result: {} }); });   // a backend for one name
    const c = mockClient();
    expect((await sendAndAwait(ws, c, { action: "open", doc: "nobody:1" })).error.code).toBe(404);
    expect((await sendAndAwait(ws, c, { action: "frobnicate" })).error.code).toBe(400);
    expect((await sendAndAwait(ws, c, { action: "call", method: "_internal" })).error.code).toBe(403);
    ws.on("call", () => { throw new Error("boom"); });
    expect((await sendAndAwait(ws, c, { action: "call", method: "x" })).error).toEqual({ code: 500, message: "boom" });
  });
});

describe("a memory document", () => {
  test("add /coll/- names its row (#14)", async () => {
    const ws = createWs();
    const here = registerMemory(ws, { prefix: "cr-here:", empty: () => ({ cr_messages: {} as Record<string, any> }), writable: "any" });
    const r = await sendAndAwait(ws, mockClient(), { action: "delta", doc: "cr-here:1", ops: [{ op: "add", path: "/cr_messages/-", value: { text: "hello" } }] });
    expect(r.error).toBeUndefined();
    const rows = here.peek("cr-here:1")!.cr_messages;
    expect(Object.keys(rows)).not.toContain("-");
    for (const [key, row] of Object.entries(rows)) expect(String((row as any).id)).toBe(key);
  });

  test("/- on an array still appends (#14)", async () => {
    const ws = createWs();
    const here = registerMemory(ws, { prefix: "cr-list:", empty: () => ({ items: [] as string[] }), writable: "any" });
    const r = await sendAndAwait(ws, mockClient(), { action: "delta", doc: "cr-list:1", ops: [{ op: "add", path: "/items/-", value: "a" }] });
    expect(r.result.ops).toEqual([{ op: "add", path: "/items/-", value: "a" }]);
    expect(here.peek("cr-list:1")).toEqual({ items: ["a"] });
  });
});
