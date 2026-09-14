import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { history, prefixDoc } from "../../src/ledger";
import { createServer } from "../../src/server";
import * as boardDoc from "./documents/board";
import * as householdDoc from "./documents/household";
import { example } from "./index";

let server: ReturnType<typeof createServer>;
/** A household of this file's own, so nothing here disturbs the seed another file reads. */
let code: string;
let hid: number;

beforeAll(() => {
  server = createServer(example, 0);
  const email = `server-${Date.now()}@example.com`;
  boardDoc.patch("DASH", [{ op: "add", path: "/households/-", value: { email, names: "Tess Test, Tom Test", plus_ones: 1 } }], "setup");
  const h = boardDoc.read("DASH")!.households.find((x) => x.email === email)!;
  code = h.code;
  hid = h.id;
});

afterAll(() => {
  server.stop(true);
});

type WireMessage = { type: string; html: string; doc?: string; version?: number; ops?: PatchOp[]; docs?: { doc: string; version: number }[] };

// A persistent per-socket FIFO queue, not a fresh {once:true} listener per nextMessage() call: two
// messages sent back-to-back by the server (a patch echo immediately followed by its render) can
// both dispatch before test code re-subscribes after awaiting the first, silently dropping one.
const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();

function connect(cookie?: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const options = cookie ? { headers: { Cookie: cookie } } : undefined;
  // tsconfig's DOM lib shadows Bun's WebSocket type, which supports `headers` at runtime.
  // @ts-expect-error
  const ws: WebSocket = new WebSocket(url, options);
  const queue: WireMessage[] = [];
  const pending: ((message: WireMessage) => void)[] = [];
  queues.set(ws, queue);
  waiters.set(ws, pending);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WireMessage;
    const waiter = pending.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return ws;
}

const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));

function nextMessage(ws: WebSocket): Promise<WireMessage> {
  const queue = queues.get(ws)!;
  if (queue.length > 0) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}

async function expectMessage(ws: WebSocket, type: string): Promise<WireMessage> {
  const message = await nextMessage(ws);
  expect(message.type).toBe(type);
  return message;
}

/** Nothing else arrives within a beat: a refused write renders once, a broadcast write renders the writer once. */
async function expectQuiet(ws: WebSocket): Promise<void> {
  await Bun.sleep(30);
  expect(queues.get(ws)!).toEqual([]);
}

const write = (ws: WebSocket, doc: string, ops: PatchOp[]) => ws.send(JSON.stringify({ doc, ops }));

/** A connection that has entered `code`: opened, greeted, entered, and rendered as that code. */
async function enter(who: string, cookie = `session_id=${crypto.randomUUID()}`): Promise<WebSocket> {
  const ws = connect(cookie);
  await opened(ws);
  await expectMessage(ws, "render");
  write(ws, "session", [{ op: "replace", path: "/code", value: who }]);
  await expectMessage(ws, "patch");
  await expectMessage(ws, "render");
  return ws;
}

describe("routes", () => {
  test("/ serves the page; a seed picture is served by its key; an unknown key is not found", async () => {
    expect((await fetch(new URL("/", server.url))).status).toBe(200);
    const res = await fetch(new URL("/pictures/seed/casserole.svg", server.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("a red casserole");
    expect((await fetch(new URL("/pictures/seed/nope.svg", server.url))).status).toBe(404);
  });

  test("a picture is kept only by the couple, only as an image, only under 8MB, and is then served", async () => {
    const post = (cookie: string | undefined, body?: BodyInit) => fetch(new URL("/api/picture", server.url), { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
    expect((await fetch(new URL("/api/picture", server.url))).status).toBe(405);
    expect((await post(undefined, new FormData())).status).toBe(403);
    const cookie = `session_id=${crypto.randomUUID()}`;
    const household = await enter(code, cookie);
    expect((await post(cookie, new FormData())).status).toBe(403);
    household.close();

    const couple = `session_id=${crypto.randomUUID()}`;
    const ws = await enter("DASH", couple);
    expect((await post(couple, "not a form")).status).toBe(400);
    const noFile = new FormData();
    noFile.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    expect((await post(couple, noFile)).status).toBe(400);
    const big = new FormData();
    big.set("file", new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect((await post(couple, big)).status).toBe(413);
    const ok = new FormData();
    ok.set("file", new File(["<svg/>"], "pic.svg", { type: "image/svg+xml" }));
    const res = await post(couple, ok);
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(key).toEndWith(".svg");
    const served = await fetch(new URL(`/pictures/${key}`, server.url));
    expect(served.headers.get("content-type")).toBe("image/svg+xml");
    expect(await served.text()).toBe("<svg/>");
    // and the key is a plain write on the document, undoable like any other
    write(ws, "board", [{ op: "replace", path: "/picture_key", value: key }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain(`/pictures/${key}`);
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(boardDoc.read("DASH")!.picture_key).toBeNull();
    ws.close();
  });
});

describe("the welcome", () => {
  test("a new connection is greeted with the welcome: the save-the-date and the code form", async () => {
    const ws = connect();
    await opened(ws);
    const { html } = await expectMessage(ws, "render");
    expect(html).toContain("Rowena");
    expect(html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/code"}\'');
    expect(html).toContain('class="site at-welcome"');
    ws.close();
  });

  test("an unknown code is not applied, and the welcome says so; a resend is acknowledged", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/code", value: "NOPE" }]);
    expect((await expectMessage(ws, "render")).html).toContain("That code was not recognised.");
    write(ws, "session", [{ op: "replace", path: "/resend", value: "x@example.com" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("Sent, if we know that address.");
    ws.close();
  });

  test("before a code, nothing else on the session may be written, nor any household or board", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/page", value: "gifts" }]);
    expect((await expectMessage(ws, "render")).html).toContain("at-welcome");
    write(ws, "household", [{ op: "replace", path: "/answer", value: "yes" }]);
    await expectMessage(ws, "render");
    write(ws, "board", [{ op: "replace", path: "/name1", value: "X" }]);
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(ws, "render");
    await expectQuiet(ws);
    ws.close();
  });
});

describe("a household", () => {
  test("entering a code opens the household's box, with the photo applet given its family; a page is a session write; leaving returns to the welcome", async () => {
    const ws = await enter(code);
    write(ws, "session", [{ op: "replace", path: "/page", value: "gifts" }]);
    await expectMessage(ws, "patch");
    const { html } = await expectMessage(ws, "render");
    expect(html).toContain("Gifts");
    expect(html).toContain("Honeymoon fund");
    write(ws, "session", [{ op: "replace", path: "/page", value: "" }]);
    await expectMessage(ws, "patch");
    const box = (await expectMessage(ws, "render")).html;
    expect(box).toContain(`<b aria-current="page">${code}</b>`);
    expect(box).toContain('data-applet="photo"');
    expect(box).toContain("Tess");
    write(ws, "session", [{ op: "remove", path: "/code" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("at-welcome");
    ws.close();
  });

  test("a write echoes to the household's tabs and the couple's, and re-renders everyone once", async () => {
    const mine = await enter(code);
    const other = await enter(code); // a second tab, same household
    const couple = await enter("DASH");
    const stranger = await enter("OKAFOR");

    write(mine, "household", [{ op: "replace", path: "/answer", value: "maybe" }]);
    const patch = await expectMessage(mine, "patch");
    expect(patch).toMatchObject({ doc: "household", ops: [{ op: "replace", path: "/answer", value: "maybe" }] });
    expect((await expectMessage(mine, "render")).html).toContain("face-mark maybe");
    await expectQuiet(mine); // rendered once, not twice
    await expectMessage(other, "patch");
    await expectMessage(other, "render");
    await expectMessage(couple, "patch");
    expect((await expectMessage(couple, "render")).html).toMatch(/\d+ answered/);
    // a stranger's household sees the world change (the photo, the board's counts) but never the other household's patch
    expect((await expectMessage(stranger, "render")).type).toBe("render");
    await expectQuiet(stranger);

    for (const ws of [mine, other, couple, stranger]) ws.close();
  });

  test("permit: only the household's own surface, only while answers are open, a plus-one only while one is owed", async () => {
    const ws = await enter(code);
    const refused = async (doc: string, ops: PatchOp[]) => {
      write(ws, doc, ops);
      expect((await nextMessage(ws)).type).toBe("render"); // no patch: nothing applied
      await expectQuiet(ws);
    };
    await refused("household", [{ op: "replace", path: "/code", value: "X" }]);
    await refused("household", [{ op: "remove", path: "/guests/1" }]);
    await refused("household", [{ op: "add", path: "/answer", value: "yes" }]);
    await refused("board", [{ op: "replace", path: "/name1", value: "X" }]);
    await refused("nothing", [{ op: "replace", path: "/x", value: "X" }]);

    // one plus-one is owed: the first is taken, the second refused
    write(ws, "household", [{ op: "add", path: "/guests/-", value: "Plus One" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("Plus");
    await refused("household", [{ op: "add", path: "/guests/-", value: "Plus Two" }]);

    // after the deadline the answer, coming and the choices are locked; the look and the words are not
    boardDoc.patch("DASH", [{ op: "replace", path: "/deadline", value: "2000-01-01" }], "setup");
    await refused("household", [{ op: "replace", path: "/answer", value: "yes" }]);
    await refused("household", [{ op: "replace", path: `/guests/${householdDoc.read(code)!.guests[0]!.id}/coming`, value: 1 }]);
    write(ws, "session", [{ op: "replace", path: "/answering", value: "1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("Answers closed on");
    write(ws, "household", [{ op: "replace", path: "/message", value: "Still allowed" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("Still allowed");
    boardDoc.patch("DASH", [{ op: "remove", path: "/deadline" }], "setup");
    ws.close();
  });

  test("the drawers: a guest's (the dress and menu applets), a gift's, the answer's -- each opened and closed by a session write", async () => {
    const ws = await enter(code);
    const guest = householdDoc.read(code)!.guests[0]!;
    write(ws, "session", [{ op: "replace", path: "/focus", value: guest.id }]);
    await expectMessage(ws, "patch");
    let html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('data-applet="dress"');
    expect(html).toContain('data-applet="menu"');
    expect(html).toContain(`aria-label="${guest.name}"`);
    write(ws, "session", [{ op: "remove", path: "/focus" }, { op: "replace", path: "/gift", value: 1 }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).not.toContain('data-applet="dress"');
    expect(html).toContain("Le Creuset casserole");
    expect(html).toContain('data-write=\'{"doc":"household","op":"add","path":"/claims/-"}\' data-value="1"');
    write(ws, "session", [{ op: "remove", path: "/gift" }, { op: "replace", path: "/answering", value: "1" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('aria-label="Our answer"');
    expect(html).toContain('data-write=\'{"doc":"household","op":"replace","path":"/answer"}\' data-value="yes"');
    ws.close();
  });

  test("the list reading, the asks page, the day, where to stay, everyone (and one family), a page that does not exist", async () => {
    const ws = await enter(code);
    const page = async (value: string) => {
      write(ws, "session", [{ op: "replace", path: "/page", value }]);
      await expectMessage(ws, "patch");
      return (await expectMessage(ws, "render")).html;
    };
    write(ws, "session", [{ op: "replace", path: "/reading/guests", value: "list" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('class="row-line guest"');
    expect(await page("asks")).toContain("Ask to bring someone");
    expect(await page("day")).toContain("Ceremony");
    expect(await page("stay")).toContain("Brooks Guesthouse");
    const everyone = await page("everyone");
    expect(everyone).toContain("in the photo");
    expect(await page("everyone/1")).toContain("One family");
    expect(await page("everyone/999")).not.toContain("One family");
    expect(await page("nowhere")).toContain(`<b aria-current="page">${code}</b>`); // the box
    ws.close();
  });

  test("undo walks back this session's own writes, newest first, through the household's replay", async () => {
    const ws = await enter(code);
    const guest = householdDoc.read(code)!.guests[0]!.id;
    write(ws, "household", [{ op: "replace", path: `/guests/${guest}/minifigure/top`, value: "#7FAE4E" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    write(ws, "household", [{ op: "add", path: "/claims/-", value: 3 }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(householdDoc.read(code)!.claims).toContain(3);

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    let patch = await expectMessage(ws, "patch");
    expect(patch).toMatchObject({ doc: "household", ops: [{ op: "remove", path: "/claims/3" }] });
    await expectMessage(ws, "render");
    expect(householdDoc.read(code)!.claims).not.toContain(3);

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    patch = await expectMessage(ws, "patch");
    expect(patch.ops).toEqual([{ op: "replace", path: `/guests/${guest}/minifigure/top`, value: "#1E3F8F" }, { op: "remove", path: `/guests/${guest}/minifigure/built_at` }]);
    await expectMessage(ws, "render");
    expect(history(prefixDoc("household", code), 1)[0]!).toMatchObject({ ops: patch.ops });

    // nothing left to undo: a render, no patch
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(ws, "render");
    await expectQuiet(ws);
    ws.close();
  });

  test("inspect reports the session and the household this connection sees", async () => {
    const ws = await enter(code);
    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");
    expect(inspection.docs!.map((d) => d.doc)).toEqual(["session", "household"]);
    ws.close();
  });
});

describe("the couple", () => {
  test("the couple's code opens the home, the households, a family, its asks, and the four lists", async () => {
    const ws = await enter("DASH");
    const page = async (value: string) => {
      write(ws, "session", [{ op: "replace", path: "/page", value }]);
      await expectMessage(ws, "patch");
      return (await expectMessage(ws, "render")).html;
    };
    expect(await page("")).toContain('data-applet="picture-field"');
    const households = await page("households");
    expect(households).toContain("Invite a household");
    expect(households).toContain('data-applet="photo"');
    write(ws, "session", [{ op: "replace", path: "/reading/households", value: "list" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("chase");
    expect(await page(`households/${hid}`)).toContain("Plus-ones");
    expect(await page(`households/${hid}/asks`)).toContain("They have not asked for anyone.");
    expect(await page("households/999999")).toContain("Invite a household");
    for (const table of ["courses", "gifts", "events", "places"]) expect(await page(table)).toContain("Add a ");
    write(ws, "session", [{ op: "replace", path: "/keep", value: "courses/1" }]);
    await expectMessage(ws, "patch");
    const drawer = (await expectMessage(ws, "render")).html;
    expect(drawer).toContain("Add a dish");
    expect(drawer).toContain("Remove this course");
    write(ws, "session", [{ op: "replace", path: "/keep", value: "gifts/2" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('aria-label="Shared: any number may claim it"');
    write(ws, "session", [{ op: "replace", path: "/keep", value: "events/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("2027-04-02T13:00");
    write(ws, "session", [{ op: "replace", path: "/keep", value: "places/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("how far, how to book");
    write(ws, "session", [{ op: "replace", path: "/keep", value: "nope/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).not.toContain("keep-sheet");
    ws.close();
  });

  test("a family's box reads its guests as the photo or the list, and its asks once answered", async () => {
    const ws = await enter("DASH");
    const guest = householdDoc.read(code)!.guests[0]!.id;
    householdDoc.patch(code, [{ op: "replace", path: `/guests/${guest}/coming`, value: 1 }, { op: "add", path: "/asks/-", value: "Answered" }], "setup");
    const ask = householdDoc.read(code)!.asks.find((a) => a.name === "Answered")!;
    boardDoc.patch("DASH", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "no" }], "setup");
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}` }, { op: "replace", path: `/reading/family-${hid}`, value: "list" }]);
    await expectMessage(ws, "patch");
    const list = (await expectMessage(ws, "render")).html;
    expect(list).toContain('<span class="said">coming</span>');
    expect(list).toContain('<span class="said">not said</span>');
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}/asks` }]);
    await expectMessage(ws, "patch");
    const asks = (await expectMessage(ws, "render")).html;
    expect(asks).toContain("Answered");
    expect(asks).toContain('class="answer-word no"');
    householdDoc.patch(code, [{ op: "remove", path: `/guests/${guest}/coming` }, { op: "remove", path: `/asks/${ask.id}` }], "setup");
    ws.close();
  });

  test("beyond sixteen in the photo, everyone sees the families, one figure each with its count, and a family opens", async () => {
    const couple = await enter("DASH");
    const email = `crowd-${Date.now()}@example.com`;
    const names = Array.from({ length: 17 }, (_, i) => `Guest${i}`).join(",");
    write(couple, "board", [{ op: "add", path: "/households/-", value: { email, names } }]);
    await expectMessage(couple, "patch");
    await expectMessage(couple, "render");
    const crowd = boardDoc.read("DASH")!.households.find((h) => h.email === email)!;
    householdDoc.patch(crowd.code, [{ op: "replace", path: "/answer", value: "yes" }], "setup");
    const ws = await enter(crowd.code);
    write(ws, "session", [{ op: "replace", path: "/page", value: "everyone" }]);
    await expectMessage(ws, "patch");
    const families = (await expectMessage(ws, "render")).html;
    expect(families).toContain("Tap a family to see them");
    expect(families).toContain("&quot;count&quot;:17");
    write(ws, "session", [{ op: "replace", path: "/page", value: `everyone/${crowd.id}` }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("One family, 17 of them.");
    ws.close();
    write(couple, "ledger", [{ op: "remove", path: "/latest" }]); // the crowd goes home
    await expectMessage(couple, "patch");
    await expectMessage(couple, "render");
    couple.close();
  });

  test("a yes to an ask makes a guest the household sees; the couple's undo takes it back; a household may not reply", async () => {
    const couple = await enter("DASH");
    const household = await enter(code);
    write(household, "household", [{ op: "add", path: "/asks/-", value: "Friend" }]);
    await expectMessage(household, "patch");
    await expectMessage(household, "render");
    await expectMessage(couple, "patch");
    expect((await expectMessage(couple, "render")).html).toMatch(/\d+ asks? waiting/);
    const ask = householdDoc.read(code)!.asks[0]!;

    write(household, "board", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "yes" }]);
    await expectMessage(household, "render");
    await expectQuiet(household);

    write(couple, "board", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "yes" }]);
    expect(await expectMessage(couple, "patch")).toMatchObject({ doc: "board" });
    await expectMessage(couple, "render");
    expect((await expectMessage(household, "render")).html).toContain("Friend");
    expect(householdDoc.read(code)!.guests.map((g) => g.name)).toContain("Friend");

    write(couple, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(couple, "patch")).toMatchObject({ doc: "board", ops: [{ op: "remove", path: `/households/${hid}/asks/${ask.id}/reply` }] });
    await expectMessage(couple, "render");
    await expectMessage(household, "render");
    expect(householdDoc.read(code)!.guests.map((g) => g.name)).not.toContain("Friend");
    couple.close();
    household.close();
  });

  test("an invitation, and its undo, through the wire", async () => {
    const ws = await enter("DASH");
    const email = `wire-${Date.now()}@example.com`;
    write(ws, "board", [{ op: "add", path: "/households/-", value: { email, names: "Wire Test", plus_ones: "0" } }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    const invited = boardDoc.read("DASH")!.households.find((h) => h.email === email)!;
    expect(invited.guests.map((g) => g.name)).toEqual(["Wire Test"]);
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(boardDoc.read("DASH")!.households.find((h) => h.email === email)).toBeUndefined();
    ws.close();
  });

  test("a household's tab whose code stops existing is back at the welcome", async () => {
    const couple = await enter("DASH");
    const email = `gone-${Date.now()}@example.com`;
    write(couple, "board", [{ op: "add", path: "/households/-", value: email }]);
    await expectMessage(couple, "patch");
    await expectMessage(couple, "render");
    const gone = boardDoc.read("DASH")!.households.find((h) => h.email === email)!;
    const tab = await enter(gone.code);
    write(couple, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(couple, "patch");
    await expectMessage(couple, "render");
    expect((await expectMessage(tab, "render")).html).toContain("at-welcome");
    couple.close();
    tab.close();
  });
});
