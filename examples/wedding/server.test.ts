import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import type { HtmlOp } from "../../src/compartments/render";
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

type WireMessage = {
  type: string;
  html?: string;
  doc?: string;
  version?: number;
  ops?: PatchOp[] | HtmlOp[];
  docs?: { doc: string; version: number }[];
};

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

/** A render's HTML, whether it came as the whole page or as fragment ops -- item 10's rule 2
 * default is a single replace of the owning compartment's own element, which for household and
 * board carries their entire page just as a full render would, so a content check doesn't need
 * to care which shape it arrived as. */
const htmlOf = (m: WireMessage): string => m.html ?? ((m.ops ?? []) as { html?: string }[]).map((o) => o.html ?? "").join("");

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
    // the picture shows in the welcome's own drawer (rule 15: the couple's welcome is a "thing", its picture with it)
    write(ws, "session", [{ op: "replace", path: "/page", value: "?answer" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    // and the key is a plain write on the document, undoable like any other
    write(ws, "board", [{ op: "replace", path: "/picture_key", value: key }]);
    await expectMessage(ws, "patch");
    expect(htmlOf(await expectMessage(ws, "render"))).toContain(`/pictures/${key}`);
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
    expect(patch).toMatchObject({ doc: `household:${code}`, ops: [{ op: "replace", path: "/answer", value: "maybe" }] });
    expect(htmlOf(await expectMessage(mine, "render"))).toContain("face-mark maybe");
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

  test("the wire may name a plus-one or an ask and nothing more: the whole-row shape is undo's, not a household's", async () => {
    const email = `shape-${Date.now()}@example.com`;
    boardDoc.patch("DASH", [{ op: "add", path: "/households/-", value: { email, names: "Sly Test", plus_ones: 1 } }], "setup");
    const own = boardDoc.read("DASH")!.households.find((x) => x.email === email)!.code;
    const ws = await enter(own);

    // a guest dressed up as the couple's own, already coming, with an id of its choosing -- and a second in the same message
    write(ws, "household", [
      { op: "add", path: "/guests/-", value: { name: "Uninvited One", named_by: "couple", coming: 1, id: 987654 } },
      { op: "add", path: "/guests/-", value: { name: "Uninvited Two", named_by: "couple" } },
    ]);
    expect((await expectMessage(ws, "patch")).ops).toHaveLength(1); // one plus-one was owed, so one is taken
    await expectMessage(ws, "render");
    const guests = householdDoc.read(own)!.guests;
    expect(guests.map((g) => g.name)).toEqual(["Sly Test", "Uninvited One"]);
    expect(guests[1]).toMatchObject({ named_by: "household", coming: null }); // counted against the invitation, not yet answered for
    expect(guests[1]!.id).not.toBe(987654);

    // and it was counted: nothing more is owed
    write(ws, "household", [{ op: "add", path: "/guests/-", value: { name: "Uninvited Three", named_by: "couple" } }]);
    expect((await nextMessage(ws)).type).toBe("render"); // no patch: nothing applied
    expect(householdDoc.read(own)!.guests).toHaveLength(2);

    // an ask cannot arrive already answered
    write(ws, "household", [{ op: "add", path: "/asks/-", value: { name: "Cousin Vim", reply: "yes", guest_id: guests[0]!.id } }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(householdDoc.read(own)!.asks.at(-1)).toMatchObject({ name: "Cousin Vim", reply: null, guest_id: null });
    ws.close();
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
    expect(htmlOf(await expectMessage(ws, "render"))).toContain("Plus");
    await refused("household", [{ op: "add", path: "/guests/-", value: "Plus Two" }]);

    // after the deadline the answer, coming and the choices are locked; the look and the words are not
    boardDoc.patch("DASH", [{ op: "replace", path: "/deadline", value: "2000-01-01" }], "setup");
    await refused("household", [{ op: "replace", path: "/answer", value: "yes" }]);
    await refused("household", [{ op: "replace", path: `/guests/${householdDoc.read(code)!.guests[0]!.id}/coming`, value: 1 }]);
    write(ws, "session", [{ op: "replace", path: "/page", value: "?answer" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("Answers closed on");
    write(ws, "household", [{ op: "replace", path: "/message", value: "Still allowed" }]);
    await expectMessage(ws, "patch");
    expect(htmlOf(await expectMessage(ws, "render"))).toContain("Still allowed");
    boardDoc.patch("DASH", [{ op: "remove", path: "/deadline" }], "setup");
    ws.close();
  });

  test("the drawers: a guest's (the dress and menu applets), a gift's, the answer's -- each opened and closed by a session write", async () => {
    const ws = await enter(code);
    const guest = householdDoc.read(code)!.guests[0]!;
    write(ws, "session", [{ op: "replace", path: "/page", value: `?guest=${guest.id}` }]);
    await expectMessage(ws, "patch");
    let html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('data-applet="dress"');
    expect(html).toContain('data-applet="menu"');
    expect(html).toContain(`aria-label="${guest.name}"`);
    write(ws, "session", [{ op: "replace", path: "/page", value: "?gift=1" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).not.toContain('data-applet="dress"');
    expect(html).toContain("Le Creuset casserole");
    expect(html).toContain('data-write=\'{"doc":"household","op":"add","path":"/claims/-"}\' data-value="1"');
    write(ws, "session", [{ op: "replace", path: "/page", value: "?answer" }]);
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
    await page("guests"); // the guests grow into the window (rule 7); their list reading is there
    write(ws, "session", [{ op: "replace", path: "/reading/guests", value: "list" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('class="row tap"');
    expect(await page("asks")).toContain("Ask to bring someone");
    // the plus asks in a modal; the add that answers it closes it (rule 14)
    write(ws, "session", [{ op: "replace", path: "/page", value: "asks?new=asks" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('<dialog open class="modal" aria-label="Ask to bring someone">');
    write(ws, "household", [{ op: "add", path: "/asks/-", value: "Modal Friend" }]);
    await expectMessage(ws, "patch");
    expect(htmlOf(await expectMessage(ws, "render"))).not.toContain('class="modal"');
    householdDoc.patch(code, [{ op: "remove", path: `/asks/${householdDoc.read(code)!.asks.at(-1)!.id}` }], "setup");
    // a waiting ask, then answered both ways -- the asks list's own row for each
    householdDoc.patch(code, [{ op: "add", path: "/asks/-", value: "Robin Friend" }], "setup");
    const askId = householdDoc.read(code)!.asks.at(-1)!.id;
    // the guests' list reading carries a waiting ask as a ghost row, beneath the named guests
    expect(await page("guests")).toContain("a waiting ask — not a guest yet");
    expect(await page("asks")).toContain("waiting");
    boardDoc.patch("DASH", [{ op: "replace", path: `/households/${hid}/asks/${askId}/reply`, value: "yes" }], "setup");
    expect(await page("asks")).toContain("yes — a guest now");
    boardDoc.patch("DASH", [{ op: "replace", path: `/households/${hid}/asks/${askId}/reply`, value: "no" }], "setup");
    expect(await page("asks")).toContain("no");
    householdDoc.patch(code, [{ op: "remove", path: `/asks/${askId}` }], "setup");
    expect(await page("day")).toContain("Ceremony");
    expect(await page("stay")).toContain("Brooks Guesthouse");
    const everyone = await page("everyone");
    expect(everyone).toContain("in the photo");
    expect(await page("everyone/1")).toContain("One family");
    expect(await page("everyone/999")).not.toContain("One family");
    expect(await page("nowhere")).toContain(`<b aria-current="page">${code}</b>`); // the box
    ws.close();
  });

  test("find dims what the word misses, keeps lit what it hits, tallies, and forgets on close (rule 17)", async () => {
    const ws = await enter(code);
    const guests = householdDoc.read(code)!.guests;
    let html: string | undefined;
    write(ws, "session", [{ op: "replace", path: "/page", value: "guests" }]); // find is on the guests' window
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    // opening find: the field appears, empty, dimming nobody
    write(ws, "session", [{ op: "replace", path: "/filter/guests", value: "" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="filter"');
    expect(html).not.toContain(" hushed");

    // typing dims what the word misses, keeps the rest lit, and tallies -- in both readings
    write(ws, "session", [{ op: "replace", path: "/filter/guests", value: guests[0]!.name }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain(`&quot;hushed&quot;:true`); // the photo applet's own props, one entry hushed
    expect(html).toContain(`>1 of ${guests.length}</span>`);
    write(ws, "session", [{ op: "replace", path: "/reading/guests", value: "list" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="row tap hushed"');
    expect(html).toContain(`>1 of ${guests.length}</span>`);

    // a waiting ask hushes too, by its own name, when the word misses it
    householdDoc.patch(code, [{ op: "add", path: "/asks/-", value: "Nobody Matching" }], "setup");
    const askId = householdDoc.read(code)!.asks.at(-1)!.id;
    write(ws, "session", [{ op: "replace", path: "/page", value: "guests" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="row hushed"');
    householdDoc.patch(code, [{ op: "remove", path: `/asks/${askId}` }], "setup");

    // closing find forgets the word: nothing dims, no field, no tally
    write(ws, "session", [{ op: "remove", path: "/filter/guests" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).not.toContain('class="filter"');
    expect(html).not.toContain(" hushed");
    expect(html).not.toContain('class="tally"');

    // the gifts collection carries find too, once open, dimming its own rows
    write(ws, "session", [{ op: "replace", path: "/page", value: "gifts" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    const giftName = boardDoc.read("DASH")!.gifts[0]!.name;
    write(ws, "session", [{ op: "replace", path: "/filter/gifts", value: giftName }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="filter"');
    expect(html).toContain('class="row tap hushed"');
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
    expect(patch).toMatchObject({ doc: `household:${code}`, ops: [{ op: "remove", path: "/claims/3" }] });
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

  test("a look or a choice goes out as fragments: the pieces that show that guest, per viewer, and nothing to anyone else", async () => {
    const guest = householdDoc.read(code)!.guests[0]!.id;
    const mine = await enter(code);
    const list = await enter(code);
    const everyone = await enter("OKAFOR");
    const elsewhere = await enter("OKAFOR");
    const board = await enter("DASH");
    const family = await enter("DASH");
    const familyBox = await enter("DASH");
    const home = await enter("DASH");
    const welcome = connect(); // no code yet: still asked, and answered with its page
    await opened(welcome);
    await expectMessage(welcome, "render");
    const page = async (ws: WebSocket, ops: PatchOp[]) => {
      write(ws, "session", ops);
      await expectMessage(ws, "patch");
      await expectMessage(ws, "render");
    };
    await page(mine, [{ op: "replace", path: "/page", value: `guests?guest=${guest}` }]);
    await page(list, [{ op: "replace", path: "/page", value: "guests" }, { op: "replace", path: "/reading/guests", value: "list" }]);
    await page(everyone, [{ op: "replace", path: "/page", value: "everyone" }]);
    await page(elsewhere, [{ op: "replace", path: "/page", value: "gifts" }]);
    await page(board, [{ op: "replace", path: "/page", value: "households" }]);
    await page(family, [{ op: "replace", path: "/page", value: `households/${hid}/guests` }]);
    await page(familyBox, [{ op: "replace", path: "/page", value: `households/${hid}` }]);
    const targets = async (ws: WebSocket) => ((await expectMessage(ws, "render")).ops as { target: string }[]).map((o) => o.target);

    // a look: the family photo and the open drawer's dress for the household, the photo of everyone, the board's and the family's photos for the couple, the home's small reading
    write(mine, "household", [{ op: "replace", path: `/guests/${guest}/minifigure/hair`, value: "curls" }]);
    await expectMessage(mine, "patch");
    expect(await targets(mine)).toEqual(["#family-photo", `#dress-${guest}`]);
    await expectMessage(list, "patch");
    await expectQuiet(list); // the list reading shows no looks
    expect(await targets(everyone)).toEqual(["#everyone-photo"]);
    await expectQuiet(elsewhere);
    await expectMessage(board, "patch");
    expect(await targets(board)).toEqual(["#board-photo"]);
    await expectMessage(family, "patch");
    expect(await targets(family)).toEqual(["#family-photo"]);
    await expectMessage(familyBox, "patch");
    expect(await targets(familyBox)).toEqual(["#family-mini"]); // the family box's small reading of them, still
    await expectMessage(home, "patch");
    expect(await targets(home)).toEqual(["#board-mini"]); // the home's small reading of the families, still
    // welcome has no code, so household.render() is the one showing it (rule 1: it can still be
    // the whole page) -- and since household is this write's owner, welcome is asked too.
    expect(htmlOf(await expectMessage(welcome, "render"))).toContain("at-welcome");

    // a choice: the drawer's menu and the list's row for the household, the family's row for the couple, nothing for the photos
    await page(family, [{ op: "replace", path: `/reading/family-${hid}`, value: "list" }]);
    write(mine, "household", [{ op: "replace", path: `/guests/${guest}/choices/2/dish`, value: 5 }]);
    await expectMessage(mine, "patch");
    expect(await targets(mine)).toEqual([`#menu-${guest}`]);
    await expectMessage(list, "patch");
    expect(await targets(list)).toEqual([`#guest-${guest}`]);
    await expectQuiet(everyone);
    await expectMessage(board, "patch");
    await expectQuiet(board);
    await expectMessage(family, "patch");
    expect(await targets(family)).toEqual([`#guest-${guest}`]);
    await expectMessage(familyBox, "patch");
    await expectQuiet(familyBox); // a choice shows in no small reading

    // anything else still goes out as this compartment's own element (its whole page, in
    // substance -- household has no smaller answer for a plain message change)
    write(mine, "household", [{ op: "replace", path: "/message", value: "whole page" }]);
    await expectMessage(mine, "patch");
    expect(htmlOf(await expectMessage(mine, "render"))).toContain("whole page");
    expect(htmlOf(await expectMessage(elsewhere, "render"))).not.toBe("");

    householdDoc.patch(code, [{ op: "remove", path: `/guests/${guest}/choices/2/dish` }, { op: "replace", path: `/guests/${guest}/minifigure/hair`, value: "none" }], "setup");
    for (const ws of [mine, list, everyone, elsewhere, board, family, home, welcome]) ws.close();
  });

  test("inspect reports the session and the household this connection sees", async () => {
    const ws = await enter(code);
    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");
    expect(inspection.docs!.map((d) => d.doc)).toEqual(["session", `household:${code}`]);
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
    expect(await page("")).toContain('class="bubble couple thing"');
    // the welcome is a "thing" (rule 15): ✎ opens its own drawer, where its picture lives
    write(ws, "session", [{ op: "replace", path: "/page", value: "?answer" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('data-applet="picture-field"');
    write(ws, "session", [{ op: "replace", path: "/page", value: "" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    const households = await page("households");
    expect(households).toContain("Invite a household");
    expect(households).toContain('data-applet="photo"');
    write(ws, "session", [{ op: "replace", path: "/reading/households", value: "list" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('class="row tap"');
    // the code is a thing (rule 15): its drawer holds the email, the plus-ones and the way to chase them
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}?keep=households/${hid}` }]);
    await expectMessage(ws, "patch");
    const family = (await expectMessage(ws, "render")).html;
    expect(family).toContain("Plus-ones");
    expect(family).toContain("Chase them");
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}` }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(await page(`households/${hid}/asks`)).toContain("They have not asked for anyone.");
    expect(await page("households/999999")).toContain("Invite a household");
    for (const table of ["courses", "gifts", "events", "places"]) expect(await page(table)).toContain("Add a ");
    write(ws, "session", [{ op: "replace", path: "/page", value: "courses?keep=courses/1" }]);
    await expectMessage(ws, "patch");
    const drawer = (await expectMessage(ws, "render")).html;
    expect(drawer).toContain("Add a dish");
    expect(drawer).toContain("Remove this course");
    write(ws, "session", [{ op: "replace", path: "/page", value: "gifts?keep=gifts/2" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain('aria-label="Shared: any number may claim it"');
    write(ws, "session", [{ op: "replace", path: "/page", value: "events?keep=events/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("2027-04-02T13:00");
    write(ws, "session", [{ op: "replace", path: "/page", value: "places?keep=places/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).toContain("how far, how to book");
    write(ws, "session", [{ op: "replace", path: "/page", value: "places?keep=nope/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).not.toContain("keep-sheet");

    // adding is a plus on the collection's rail and a modal asking one question, the name; the
    // page behind it is inert while it asks (rule 14)
    write(ws, "session", [{ op: "replace", path: "/page", value: "courses?new=courses" }]);
    await expectMessage(ws, "patch");
    let html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('<dialog open class="modal" aria-label="Add a course">');
    expect(html).toContain("The course&#39;s name");
    expect(html).toContain("<div inert>");
    write(ws, "board", [{ op: "add", path: "/courses/-", value: "Pudding" }]);
    await expectMessage(ws, "patch");
    // the board has no fragments: the page comes whole
    html = htmlOf(await expectMessage(ws, "render"));
    const pudding = boardDoc.read("DASH")!.courses.find((c) => c.name === "Pudding")!;
    expect(pudding).toBeTruthy();
    // the write that answers the question closes the modal
    expect(html).not.toContain('class="modal"');
    expect(html).not.toContain("<div inert>");

    // removing asks in a modal too -- a modal is new or delete and nothing else (rule 14)
    write(ws, "session", [{ op: "replace", path: "/page", value: `courses?confirm=courses/${pudding.id}` }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain(`Remove &quot;Pudding&quot; from the list?`);
    write(ws, "board", [{ op: "remove", path: `/courses/${pudding.id}` }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    expect(boardDoc.read("DASH")!.courses.some((c) => c.id === pudding.id)).toBe(false);
    // a stale or nonsense confirm target renders no modal at all
    write(ws, "session", [{ op: "replace", path: "/page", value: "courses?confirm=courses/999999" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).not.toContain('class="modal"');
    write(ws, "session", [{ op: "replace", path: "/page", value: "courses?confirm=nope/1" }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).html).not.toContain('class="modal"');
    ws.close();
  });

  test("find dims households and the couple's own gifts, keeps lit what it hits, and tallies (rule 17)", async () => {
    const ws = await enter("DASH");
    const households = boardDoc.read("DASH")!.households;
    // two households this test alone owns, so nothing it does here leaks into any other test's
    // household (in particular not `code`'s, which many other tests share and mutate)
    // find is a substring match on the code and the names, so the word has to be a code no other
    // household's code or names contain (codes minted in the same second share a prefix)
    const text = (h: (typeof households)[number]) => `${h.code} ${h.guests.map((g) => g.name).join(" ")}`;
    const matching = households.find((h) => h.code !== code && households.filter((o) => text(o).includes(h.code)).length === 1)!;
    const other = households.find((h) => h.code !== code && h.code !== matching.code)!;

    // households, the photo reading: opening find dims the family the word misses
    write(ws, "session", [{ op: "replace", path: "/page", value: "households" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/filter/households", value: matching.code }]);
    await expectMessage(ws, "patch");
    let html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="filter"');
    expect(html).toContain(`&quot;hushed&quot;:true`);
    expect(html).toContain(`>1 of ${households.length}</span>`);

    // the list reading: the same word hushes the row, and any of its own waiting asks
    householdDoc.patch(matching.code, [{ op: "add", path: "/asks/-", value: "Someone Matching" }], "setup");
    householdDoc.patch(other.code, [{ op: "add", path: "/asks/-", value: "Someone Else" }], "setup");
    write(ws, "session", [{ op: "replace", path: "/reading/households", value: "list" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain(`class="row tap hushed" id="household-${other.id}"`);
    expect(html).toContain(`class="row tap" id="household-${matching.id}"`); // the matching household, not hushed
    expect(html).toContain("1 ask waiting"); // its waiting ask rides on its row as a note, not a row of its own
    householdDoc.patch(matching.code, [{ op: "remove", path: `/asks/${householdDoc.read(matching.code)!.asks.at(-1)!.id}` }], "setup");
    householdDoc.patch(other.code, [{ op: "remove", path: `/asks/${householdDoc.read(other.code)!.asks.at(-1)!.id}` }], "setup");
    write(ws, "session", [{ op: "remove", path: "/filter/households" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    // the couple's own gifts, kept: find dims the same way
    write(ws, "session", [{ op: "replace", path: "/page", value: "gifts" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    const giftName = boardDoc.read("DASH")!.gifts[0]!.name;
    write(ws, "session", [{ op: "replace", path: "/filter/gifts", value: giftName }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).html;
    expect(html).toContain('class="filter"');
    expect(html).toContain('class="row tap hushed"');
    expect(html).toContain(`>1 of ${boardDoc.read("DASH")!.gifts.length}</span>`);
    ws.close();
  });

  test("a family's box reads its guests as the photo or the list, and its asks once answered", async () => {
    const ws = await enter("DASH");
    const guest = householdDoc.read(code)!.guests[0]!.id;
    householdDoc.patch(code, [{ op: "replace", path: `/guests/${guest}/coming`, value: 1 }, { op: "add", path: "/asks/-", value: "Answered" }, { op: "add", path: "/asks/-", value: "Waiting" }], "setup");
    const ask = householdDoc.read(code)!.asks.find((a) => a.name === "Answered")!;
    boardDoc.patch("DASH", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "no" }], "setup");
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}/guests` }, { op: "replace", path: `/reading/family-${hid}`, value: "list" }]);
    await expectMessage(ws, "patch");
    const list = (await expectMessage(ws, "render")).html;
    expect(list).toContain('>coming</span>');
    expect(list).toContain('>not said</span>');
    write(ws, "session", [{ op: "replace", path: "/page", value: `households/${hid}/asks` }]);
    await expectMessage(ws, "patch");
    const asks = (await expectMessage(ws, "render")).html;
    expect(asks).toContain("Answered");
    expect(asks).toContain('class="answer-word no"');
    expect(asks).toContain(">Waiting</span>"); // the waiting ask's row carries the couple's yes or no
    expect(asks).toContain('class="pick" role="radiogroup" aria-label="'); // the couple's yes or no, one choice
    const waiting = householdDoc.read(code)!.asks.find((a) => a.name === "Waiting")!;
    householdDoc.patch(code, [{ op: "remove", path: `/guests/${guest}/coming` }, { op: "remove", path: `/asks/${ask.id}` }, { op: "remove", path: `/asks/${waiting.id}` }], "setup");
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
    expect(await expectMessage(couple, "patch")).toMatchObject({ doc: "board:DASH" });
    await expectMessage(couple, "render");
    expect((await expectMessage(household, "render")).html).toContain("Friend");
    expect(householdDoc.read(code)!.guests.map((g) => g.name)).toContain("Friend");

    write(couple, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(couple, "patch")).toMatchObject({ doc: "board:DASH", ops: [{ op: "remove", path: `/households/${hid}/asks/${ask.id}/reply` }] });
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
