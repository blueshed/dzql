import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { hear, type Heard } from "../../src/harness";
import { may, placed, shape, type Person, type Team } from "./documents";
import { days } from "./page";
import { example } from "./index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

/** Posts the sign-in form, as a browser does: the answer, and the session its cookie names. */
async function signIn(email: string, password: string, headers: Record<string, string> = {}): Promise<{ res: Response; sessionId?: string }> {
  const res = await fetch(new URL("/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
  return { res, sessionId: /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
}

type Tab = { ws: WebSocket; page: string; inbox: Heard[]; answered: (() => void)[] };

/** A tab on a session: its page as the client keeps it, and everything it was sent. */
async function open(sessionId: string): Promise<Tab> {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
  const tab: Tab = { ws, page: "", inbox: [], answered: [] };
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Heard;
    if (message.type === "inspect") return tab.answered.shift()?.();
    tab.inbox.push(message);
    tab.page = hear(tab.page, message);
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  await settle(tab);
  return tab;
}

/** Everything sent before now has arrived: an inspect is answered after all of it. */
const settle = (tab: Tab): Promise<void> =>
  new Promise((resolve) => {
    tab.answered.push(resolve);
    tab.ws.send(JSON.stringify({ type: "inspect" }));
  });

async function send(tab: Tab, doc: string, ops: PatchOp[]): Promise<string> {
  tab.ws.send(JSON.stringify({ doc, ops }));
  await settle(tab);
  return tab.page;
}

const go = (tab: Tab, page: string) => send(tab, "session", [{ op: "replace", path: "/page", value: page }]);

describe("signing in", () => {
  test("a good email and password start a fresh session, named by a new cookie, never the visit's own", async () => {
    const { res, sessionId } = await signIn("ann@leave.example", "ann-password", { Cookie: "session_id=a-visit-someone-planted" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(sessionId).toBeDefined();
    expect(sessionId).not.toBe("a-visit-someone-planted");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const tab = await open(sessionId!);
    expect(tab.page).toContain("your leave");
    expect(tab.page).toContain("Sign out");
    tab.ws.close();
  });

  test("a wrong password, or an unknown email, is told on the page it came from, and signs nobody in", async () => {
    const visit = crypto.randomUUID();
    const tab = await open(visit);
    expect(tab.page).toContain('action="/login"');
    for (const [email, password] of [["ann@leave.example", "not-it"], ["nobody@leave.example", "ann-password"]] as const) {
      const { res, sessionId } = await signIn(email, password, { Cookie: `session_id=${visit}` });
      expect(res.status).toBe(303);
      expect(sessionId).toBeUndefined();
    }
    await settle(tab);
    expect(tab.page).toContain('<p class="refused" role="alert">That email and password do not match.</p>');
    expect((await signIn("ann@leave.example", "not-it")).sessionId).toBeUndefined(); // no visit to tell: nothing said, nothing kept
    tab.ws.close();
  });

  test("the page signs in, so a GET goes home; a form posted from another site is refused", async () => {
    const get = await fetch(new URL("/login", server.url), { redirect: "manual" });
    expect(get.status).toBe(303);
    const { res, sessionId } = await signIn("ann@leave.example", "ann-password", { Origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
    expect(sessionId).toBeUndefined();
  });

  test("a visitor sees only the sign-in page, and a socket from another site is refused", async () => {
    const tab = await open(crypto.randomUUID());
    expect(tab.page).toContain('action="/login"');
    expect(tab.page).not.toContain("the team");
    tab.ws.close();
    const refused = await fetch(new URL("/ws", server.url), { headers: { Origin: "https://elsewhere.example", Upgrade: "websocket", Connection: "Upgrade" } });
    expect(refused.status).toBe(403);
  });
});

describe("the pages", () => {
  test("Ann's leave, a request's drawer, the ask, taking one back; Mo answers from the team's; answered, a request says by whom", async () => {
    const ann = await open((await signIn("ann@leave.example", "ann-password")).sessionId!);
    const mo = await open((await signIn("mo@leave.example", "mo-password")).sessionId!);

    expect(await go(ann, "mine")).toContain("Fri 13 Nov");
    const drawer = await go(ann, "mine?request=2");
    expect(drawer).toContain("Your leave");
    expect(drawer).toContain("Take it back");
    expect(drawer).not.toContain("Approve"); // her own: nobody answers their own
    expect(await go(ann, "mine?confirm=2")).toContain("Take back Fri 13 Nov?");
    expect(await go(ann, "mine?new")).toContain('type="date"');
    expect(await go(ann, "team")).toContain("Bo");
    expect(await go(ann, "team?request=1")).not.toContain("Approve"); // a member does not answer
    expect(await go(ann, "team?confirm=1")).not.toContain("Take back"); // nor take back someone else's
    expect(await go(ann, "nowhere")).toContain("Bo"); // an address nobody has: she stays where she was
    expect(await go(ann, "team?request=x")).toContain("Bo");

    expect(await go(mo, "")).toContain("2 waiting for you");
    const answering = await go(mo, "team?request=2");
    expect(answering).toContain("Approve");
    await send(mo, "team", [{ op: "replace", path: "/requests/2/status", value: "declined" }]);
    await settle(ann);
    expect(await go(ann, "mine?request=2")).toContain("declined by Mo");
    expect(ann.page).not.toContain("Take it back"); // answered: nothing left to take back
    await send(mo, "ledger", [{ op: "remove", path: "/latest" }]); // as it was, for the other tests
    await settle(ann);
    expect(ann.page).toContain("Take it back");

    ann.ws.close();
    mo.ws.close();
  });

  test("a request just asked for opens its drawer, and can be taken back, by the id delta gave it", async () => {
    const ann = await open((await signIn("ann@leave.example", "ann-password")).sessionId!);
    await go(ann, "mine?new");
    await send(ann, "team", [{ op: "add", path: "/requests/-", value: { starts: "2027-01-04", ends: "2027-01-05" } }]);
    const tap = /data-value="(mine\?request=[^"]+)"[^>]*>(?:(?!<\/div>).)*Mon 4 – Tue 5 Jan/.exec(ann.page)?.[1];
    expect(tap).toBeDefined();
    const drawer = await go(ann, tap!);
    expect(drawer).toContain("Take it back");
    await go(ann, tap!.replace("request", "confirm"));
    const id = tap!.split("=")[1];
    expect(await send(ann, "team", [{ op: "remove", path: `/requests/${id}` }])).not.toContain("Mon 4 – Tue 5 Jan");
    await send(ann, "ledger", [{ op: "remove", path: "/latest" }]); // the take-back undone...
    await send(ann, "ledger", [{ op: "remove", path: "/latest" }]); // ...and the ask: as it was
    ann.ws.close();
  });

  test("Bo, with nothing asked for, is told so; Mo sees a team with nobody waiting on him when nobody is", async () => {
    const bo = await open((await signIn("bo@leave.example", "bo-password")).sessionId!);
    await go(bo, "mine?confirm=1");
    await send(bo, "team", [{ op: "remove", path: "/requests/1" }]);
    expect(await go(bo, "mine")).toContain("Nothing asked for yet");
    expect(await go(bo, "")).toContain("nothing asked for yet");
    await send(bo, "ledger", [{ op: "remove", path: "/latest" }]);
    bo.ws.close();
  });
});

describe("the rules, on their own", () => {
  const ann: Person = { id: "1", name: "Ann", role: "member" };
  const mo: Person = { id: "3", name: "Mo", role: "manager" };
  const t: Team = {
    name: "The studio",
    people: [ann, mo],
    requests: [
      { id: "1", person_id: "1", starts: "2026-10-05", ends: "2026-10-09", status: "asked", answered_by: null },
      { id: "2", person_id: "1", starts: "2026-11-13", ends: "2026-11-13", status: "approved", answered_by: "3" },
    ],
  };

  test("an address: the box, a window, a drawer, the ask on your own leave, the asking-first -- or nowhere", () => {
    expect(placed("")).toBe("");
    expect(placed("team?request=2")).toBe("team?request=2");
    expect(placed("mine?new")).toBe("mine?new");
    expect(placed("team?new")).toBeUndefined();
    expect(placed("mine?confirm=a b")).toBeUndefined();
    expect(placed("mine?confirm=0199a1b2-c3d4")).toBe("mine?confirm=0199a1b2-c3d4"); // an id delta named
    expect(placed("mine?wander")).toBeUndefined();
    expect(placed("attic")).toBeUndefined();
    expect(placed(undefined)).toBe("");
  });

  test("asking is anyone's; taking back is the asker's while it waits; answering is a manager's, for someone else, while it waits", () => {
    expect(may(ann, { op: "add", path: "/requests/-" }, t)).toBe(true);
    expect(may(ann, { op: "add", path: "/requests/-/x" }, t)).toBe(false);
    expect(may(ann, { op: "remove", path: "/requests/1" }, t)).toBe(true);
    expect(may(ann, { op: "remove", path: "/requests/2" }, t)).toBe(false); // answered
    expect(may(ann, { op: "remove", path: "/requests/9" }, t)).toBe(false); // nobody's
    expect(may(mo, { op: "remove", path: "/requests/1" }, t)).toBe(false);
    expect(may(mo, { op: "replace", path: "/requests/1/status", value: "approved" }, t)).toBe(true);
    expect(may(mo, { op: "replace", path: "/requests/1/status", value: "maybe" }, t)).toBe(false);
    expect(may(mo, { op: "replace", path: "/requests/1/starts", value: "2026-01-01" }, t)).toBe(false);
    expect(may(ann, { op: "replace", path: "/requests/1/status", value: "approved" }, t)).toBe(false);
    expect(may(ann, { op: "replace", path: "/people/1/role", value: "manager" }, t)).toBe(false);
  });

  test("an ask is made whole and its days checked; an answer is signed", () => {
    expect(shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-01", ends: "2026-12-04" } }])).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: "1", starts: "2026-12-01", ends: "2026-12-04", status: "asked", answered_by: null } },
    ]);
    expect(shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "soon", ends: "2026-12-04" } }])).toEqual([]);
    expect(shape(ann, [{ op: "add", path: "/requests/-" }])).toEqual([]);
    expect(() => shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-04", ends: "2026-12-01" } }])).toThrow("The last day is before the first.");
    expect(shape(mo, [{ op: "replace", path: "/requests/1/status", value: "approved" }])).toEqual([
      { op: "replace", path: "/requests/1/status", value: "approved" },
      { op: "replace", path: "/requests/1/answered_by", value: "3" },
    ]);
    expect(shape(ann, [{ op: "remove", path: "/requests/1" }])).toEqual([{ op: "remove", path: "/requests/1" }]);
  });

  test("days as a person says them", () => {
    expect(days({ starts: "2026-10-05", ends: "2026-10-09" })).toBe("Mon 5 – Fri 9 Oct");
    expect(days({ starts: "2026-11-13", ends: "2026-11-13" })).toBe("Fri 13 Nov");
  });
});
