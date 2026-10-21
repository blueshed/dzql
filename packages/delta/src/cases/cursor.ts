/**
 * The cursor over a socket, the same on every backend: the server mints a key on the upgrade (the
 * `delta_cursor` cookie, HttpOnly, never in the URL) and binds the cursor to it, so a socket that
 * names another's `clientId` walks none of their writes, while they are connected or after they
 * leave; the same browser, its key sent back, walks its own. These are signed out; signed in, the
 * person is in the cursor too (`tests/ledger.test.ts`).
 *
 *   cursorCases(standUp);
 *
 * where `standUp` is a `CaseBackend` that keeps a ledger when the app asks (`ledger: true`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CaseApp, CaseBackend } from "./writes";
import { roomsApp } from "./writes";
import type { WsServer } from "../server/server";
import { mockClient, sendAndAwait, type MockClient } from "./support";

/** The rooms of the write cases, on the ledger. */
export const ledgerRoomsApp: CaseApp = { ...roomsApp, ledger: true };

/** A socket as the server's upgrade makes it, naming `clientId` and sending `cookie` (a browser's), and the cookie the upgrade set, if any. */
async function upgraded(ws: WsServer, { clientId, cookie }: { clientId?: string; cookie?: string } = {}): Promise<{ client: MockClient; set?: string }> {
  const req = new Request(`http://localhost${ws.path}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`, { headers: cookie ? { cookie } : {} });
  let given: { data: Record<string, unknown>; headers?: Record<string, string> } | undefined;
  const refused = await ws.upgrade(req, { upgrade: (_req: Request, o: any) => ((given = o), true) });
  if (refused || !given) throw new Error("the upgrade was refused");
  const client = mockClient(given.data);
  ws.websocket.open(client);
  return { client, set: given.headers?.["Set-Cookie"] };
}

/** The cookie as a browser sends it back: its name and value. */
const sentBack = (set: string | undefined) => set!.split(";")[0]!;

export function cursorCases(backend: CaseBackend): void {
  describe("the cursor over a socket: bound to the key the server minted, never the id alone", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(ledgerRoomsApp); });
    afterEach(async () => { await up.end(); });

    const say = async (client: MockClient, text: string) => {
      await sendAndAwait(up.ws, client, { action: "open", doc: "case-room:1" });
      const r = await sendAndAwait(up.ws, client, { action: "delta", doc: "case-room:1", ops: [{ op: "add", path: "/case_messages/-", value: { text } }] });
      expect(r.error).toBeUndefined();
    };
    const undo = async (client: MockClient) => (await sendAndAwait(up.ws, client, { action: "undo" })).result;
    const texts = async () => {
      const r = await sendAndAwait(up.ws, mockClient({ clientId: "reader" }), { action: "open", doc: "case-room:1" });
      return Object.values(r.result.case_messages).map((m: any) => m.text);
    };
    const leave = (client: MockClient) => { client.readyState = 3; up.ws.websocket.close(client); };

    test("a socket that sends no key is given one, on a cookie a page cannot read; one that sends it back is given none", async () => {
      const { set } = await upgraded(up.ws, { clientId: "case-tab" });
      expect(set).toMatch(/^delta_cursor=[A-Za-z0-9_-]{16,128}; Path=\/ws; HttpOnly; SameSite=Strict$/);
      expect((await upgraded(up.ws, { clientId: "case-tab", cookie: sentBack(set) })).set).toBeUndefined();
    });

    test("a socket that names another's clientId walks none of their writes, while they are connected or after they leave", async () => {
      const ada = await upgraded(up.ws, { clientId: "case-tab" });
      await say(ada.client, "ada's");
      const beside = await upgraded(up.ws, { clientId: "case-tab" });   // ada still connected
      expect(await undo(beside.client)).toBeNull();
      leave(ada.client);
      const after = await upgraded(up.ws, { clientId: "case-tab" });    // ada gone: the id is free
      expect(await undo(after.client)).toBeNull();
      const keyed = await upgraded(up.ws, { clientId: "case-tab", cookie: sentBack(beside.set) });   // a key of its own
      expect(await undo(keyed.client)).toBeNull();
      expect(await texts()).toContain("ada's");
    });

    test("the same browser, its key sent back, walks its own: after it left, and while its old socket is still open", async () => {
      const first = await upgraded(up.ws, { clientId: "case-tab" });
      const cookie = sentBack(first.set);
      await say(first.client, "one");
      await say(first.client, "two");
      const beside = await upgraded(up.ws, { clientId: "case-tab", cookie });   // a reconnect the server has not seen the drop of
      expect((await undo(beside.client))?.ops?.[0]?.op).toBe("remove");
      expect(await texts()).not.toContain("two");
      leave(first.client);
      leave(beside.client);
      const again = await upgraded(up.ws, { clientId: "case-tab", cookie });
      expect((await undo(again.client))?.ops?.[0]?.op).toBe("remove");
      expect(await texts()).not.toContain("one");
    });
  });
}
