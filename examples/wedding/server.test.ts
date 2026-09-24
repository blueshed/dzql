import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import type { HtmlOp } from "../../src/compartments/render";
import { createServer } from "../../src/server";
import { hear, type Heard as HeardRender } from "../../src/harness";
import { asCouple, asHousehold, board, household } from "./setup";
import { example } from "./index";

let server: ReturnType<typeof createServer>;
/** A household of this file's own, so nothing here disturbs the seed another file reads. */
let code: string;
let hid: number;

beforeAll(async () => {
  server = createServer(example, 0);
  const email = `server-${Date.now()}@example.com`;
  await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Tess Test, Tom Test", plus_ones: 1 } }]);
  const h = (await board()).households.find((x) => x.email === email)!;
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

const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();
/** The page each connection holds, from everything it has been sent, as the client keeps it. */
const held = new WeakMap<WebSocket, string>();

function connect(cookie?: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const options = cookie ? { headers: { Cookie: cookie } } : undefined;
  // tsconfig's DOM lib shadows Bun's WebSocket type, which supports `headers` at runtime.
  // @ts-expect-error
  const ws: WebSocket = new WebSocket(url, options);
  queues.set(ws, []);
  waiters.set(ws, []);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WireMessage;
    if (message.type === "render") held.set(ws, hear(held.get(ws) ?? "", message as HeardRender));
    const waiter = waiters.get(ws)!.shift();
    if (waiter) waiter(message);
    else queues.get(ws)!.push(message);
  });
  return ws;
}

const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));

function nextMessage(ws: WebSocket): Promise<WireMessage> {
  const queue = queues.get(ws)!;
  if (queue.length > 0) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}

/** What a connection was sent, up to now. */
type Heard = {
  patches: WireMessage[];
  renders: WireMessage[];
  /** The page it holds once everything it was sent is applied. */
  page: string;
  /** The parts the renders named, by key, in the order they came: "tag family-photo". */
  targets: string[];
};

/**
 * Everything a connection was sent until what came before is done: it asks (`inspect`), and the
 * answer comes only after every event before it and all it set going -- the one queue the server
 * handles events in. So after a write, each connection's `heard` is all the write caused it.
 */
async function heard(ws: WebSocket): Promise<Heard> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const messages: WireMessage[] = [];
  for (let m = await nextMessage(ws); m.type !== "inspect"; m = await nextMessage(ws)) messages.push(m);
  const renders = messages.filter((m) => m.type === "render");
  const targets = renders.flatMap((r) => ((r.ops ?? []) as { op: string; target?: string }[]).filter((o) => o.target).map((o) => `${o.op} ${/data-eta-part="(.*)"/.exec(o.target!)![1]}`));
  return { patches: messages.filter((m) => m.type === "patch"), renders, page: held.get(ws) ?? "", targets };
}

/** A write, and what its own connection was sent for it. */
function send(ws: WebSocket, doc: string, ops: PatchOp[]): Promise<Heard> {
  ws.send(JSON.stringify({ doc, ops }));
  return heard(ws);
}

/** Goes somewhere: a session write, and the page it leads to. */
const go = async (ws: WebSocket, ops: PatchOp[]): Promise<string> => (await send(ws, "session", ops)).page;
const at = (ws: WebSocket, page: string): Promise<string> => go(ws, [{ op: "replace", path: "/page", value: page }]);

/** Refused: nothing applied, nothing told -- the page handed back as it was. */
async function refused(ws: WebSocket, doc: string, ops: PatchOp[]): Promise<Heard> {
  const h = await send(ws, doc, ops);
  expect(h.patches).toEqual([]);
  expect(h.renders).toHaveLength(1);
  return h;
}

/** A connection that has entered `who`'s code: opened, greeted, entered, and drawn as that code. */
async function enter(who: string, cookie = `session_id=${crypto.randomUUID()}`): Promise<WebSocket> {
  const ws = connect(cookie);
  await opened(ws);
  await heard(ws);
  await send(ws, "session", [{ op: "replace", path: "/code", value: who }]);
  return ws;
}

const householdDoc = () => `household:${hid}`;

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
    const tab = await enter(code, cookie);
    expect((await post(cookie, new FormData())).status).toBe(403);
    tab.close();

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
    await at(ws, "?answer");
    // and the key is a plain write on the document, undoable like any other
    expect((await send(ws, "board", [{ op: "replace", path: "/picture_key", value: key }])).page).toContain(`/pictures/${key}`);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await board()).picture_key).toBeNull();
    ws.close();
  });
});

describe("the welcome", () => {
  test("a new connection is greeted with the welcome: the save-the-date and the code form", async () => {
    const ws = connect();
    await opened(ws);
    const { page } = await heard(ws);
    expect(page).toContain("Rowena");
    expect(page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/code"}\'');
    expect(page).toContain('class="site at-welcome"');
    ws.close();
  });

  test("an unknown code opens nothing, and the welcome says so; a resend is acknowledged", async () => {
    const ws = connect();
    await opened(ws);
    await heard(ws);
    const unknown = await go(ws, [{ op: "replace", path: "/code", value: "NOPE" }]);
    expect(unknown).toContain("That code was not recognised.");
    expect(unknown).toContain("at-welcome");
    expect(await go(ws, [{ op: "replace", path: "/resend", value: "x@example.com" }])).toContain("Sent, if we know that address.");
    ws.close();
  });

  test("before a code, nothing else on the session may be written, nor any household or board", async () => {
    const ws = connect();
    await opened(ws);
    await heard(ws);
    expect((await refused(ws, "session", [{ op: "replace", path: "/page", value: "gifts" }])).page).toContain("at-welcome");
    await refused(ws, "household", [{ op: "replace", path: "/answer", value: "yes" }]);
    await refused(ws, "board", [{ op: "replace", path: "/name1", value: "X" }]);
    await refused(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    ws.close();
  });
});

describe("a household", () => {
  test("entering a code opens the household's box, with the photo applet given its family; a page is a session write; leaving returns to the welcome", async () => {
    const ws = await enter(code);
    const gifts = await at(ws, "gifts");
    expect(gifts).toContain("Gifts");
    expect(gifts).toContain("Honeymoon fund");
    const box = await at(ws, "");
    expect(box).toContain(`<b aria-current="page">${code}</b>`);
    expect(box).toContain('data-applet="photo"');
    expect(box).toContain("Tess");
    expect(await go(ws, [{ op: "remove", path: "/code" }])).toContain("at-welcome");
    ws.close();
  });

  test("a write is told to the household's tabs and the couple's; another household hears what everyone may, never the household's own", async () => {
    const mine = await enter(code);
    const other = await enter(code); // a second tab, same household
    const couple = await enter("DASH");
    const stranger = await enter("OKAFOR");

    const h = await send(mine, "household", [{ op: "replace", path: "/answer", value: "maybe" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "replace", path: "/households", value: { answer: "maybe" } }] });
    expect(h.page).toContain("face-mark maybe");
    expect((await heard(other)).patches.map((p) => p.doc)).toContain(householdDoc());
    const c = await heard(couple);
    expect(c.patches.map((p) => p.doc)).toContain("board:1");
    expect(c.page).toMatch(/\d+ answered/);
    // a maybe puts the household's figures in the photo, as ghosts: the other household hears that, and nothing of this household's own
    const s = await heard(stranger);
    expect(s.patches.map((p) => p.doc)).toEqual(["everyone:1"]);
    expect(s.renders.length).toBeGreaterThan(0);

    await send(mine, "household", [{ op: "remove", path: "/answer" }]);
    for (const ws of [mine, other, couple, stranger]) ws.close();
  });

  test("the wire may name a plus-one or an ask and nothing more", async () => {
    const email = `shape-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Sly Test", plus_ones: 1 } }]);
    const own = (await board()).households.find((x) => x.email === email)!.code;
    const ws = await enter(own);

    // a guest dressed up as the couple's own, already coming, with an id of its choosing -- and a second in the same message
    const h = await send(ws, "household", [
      { op: "add", path: "/guests/-", value: { name: "Uninvited One", named_by: "couple", coming: 1, id: 987654 } },
      { op: "add", path: "/guests/-", value: { name: "Uninvited Two", named_by: "couple" } },
    ]);
    expect(h.patches[0]!.ops).toHaveLength(1); // one plus-one was owed, so one is taken
    const guests = (await household(own)).guests;
    expect(guests.map((g) => g.name)).toEqual(["Sly Test", "Uninvited One"]);
    expect(guests[1]).toMatchObject({ named_by: "household", coming: null }); // counted against the invitation, not yet answered for
    expect(guests[1]!.id).not.toBe(987654);

    // and it was counted: nothing more is owed
    await refused(ws, "household", [{ op: "add", path: "/guests/-", value: { name: "Uninvited Three", named_by: "couple" } }]);
    expect((await household(own)).guests).toHaveLength(2);

    // an ask cannot arrive already answered
    await send(ws, "household", [{ op: "add", path: "/asks/-", value: { name: "Cousin Vim", reply: "yes", guest_id: guests[0]!.id } }]);
    expect((await household(own)).asks.at(-1)).toMatchObject({ name: "Cousin Vim", reply: null, guest_id: null });
    ws.close();
  });

  test("permit: only the household's own surface, only while answers are open, a plus-one only while one is owed", async () => {
    const ws = await enter(code);
    await refused(ws, "household", [{ op: "replace", path: "/code", value: "X" }]);
    await refused(ws, "household", [{ op: "remove", path: "/guests/1" }]);
    await refused(ws, "household", [{ op: "add", path: "/answer", value: "yes" }]);
    await refused(ws, "board", [{ op: "replace", path: "/name1", value: "X" }]);
    await refused(ws, "nothing", [{ op: "replace", path: "/x", value: "X" }]);

    // one plus-one is owed: the first is taken, the second refused
    expect((await send(ws, "household", [{ op: "add", path: "/guests/-", value: "Plus One" }])).page).toContain("Plus");
    await refused(ws, "household", [{ op: "add", path: "/guests/-", value: "Plus Two" }]);

    // after the deadline the answer, coming and the choices are locked; the look and the words are not
    await asCouple([{ op: "replace", path: "/deadline", value: "2000-01-01" }]);
    await heard(ws);
    await refused(ws, "household", [{ op: "replace", path: "/answer", value: "yes" }]);
    await refused(ws, "household", [{ op: "replace", path: `/guests/${(await household(code)).guests[0]!.id}/coming`, value: 1 }]);
    expect(await at(ws, "?answer")).toContain("Answers closed on");
    expect((await send(ws, "household", [{ op: "replace", path: "/message", value: "Still allowed" }])).page).toContain("Still allowed");
    await asCouple([{ op: "remove", path: "/deadline" }]);
    ws.close();
  });

  test("the drawers: a guest's (the dress and menu applets), a gift's, the answer's -- each opened and closed by a session write", async () => {
    const ws = await enter(code);
    const guest = (await household(code)).guests[0]!;
    let html = await at(ws, `?guest=${guest.id}`);
    expect(html).toContain('data-applet="dress"');
    expect(html).toContain('data-applet="menu"');
    expect(html).toContain(`aria-label="${guest.name}"`);
    html = await at(ws, "?gift=1");
    expect(html).not.toContain('data-applet="dress"');
    expect(html).toContain("Le Creuset casserole");
    expect(html).toContain('data-write=\'{"doc":"household","op":"add","path":"/claims/-"}\' data-value="1"');
    html = await at(ws, "?answer");
    expect(html).toContain('aria-label="Our answer"');
    expect(html).toContain('data-write=\'{"doc":"household","op":"replace","path":"/answer"}\' data-value="yes"');
    ws.close();
  });

  test("the list reading, the asks page, the day, where to stay, everyone (and one family), a page that does not exist", async () => {
    const ws = await enter(code);
    await at(ws, "guests"); // the guests grow into the window (rule 7); their list reading is there
    expect(await go(ws, [{ op: "replace", path: "/reading/guests", value: "list" }])).toContain('class="row tap"');
    expect(await at(ws, "asks")).toContain("Ask to bring someone");
    // the plus asks in a modal; the add that answers it closes it (rule 14)
    expect(await at(ws, "asks?new=asks")).toContain('<dialog open class="modal" aria-label="Ask to bring someone">');
    expect((await send(ws, "household", [{ op: "add", path: "/asks/-", value: "Modal Friend" }])).page).not.toContain('class="modal"');
    // a waiting ask, then answered both ways -- the asks list's own row for each
    await asHousehold(code, [{ op: "add", path: "/asks/-", value: "Robin Friend" }]);
    const askId = (await household(code)).asks.at(-1)!.id;
    // the guests' list reading carries a waiting ask as a ghost row, beneath the named guests
    expect(await at(ws, "guests")).toContain("a waiting ask — not a guest yet");
    expect(await at(ws, "asks")).toContain("waiting");
    await asCouple([{ op: "replace", path: `/households/${hid}/asks/${askId}/reply`, value: "yes" }]);
    expect(await at(ws, "asks")).toContain("yes — a guest now");
    await asCouple([{ op: "replace", path: `/households/${hid}/asks/${askId}/reply`, value: "no" }]);
    expect(await at(ws, "asks")).toContain("no");
    expect(await at(ws, "day")).toContain("Ceremony");
    expect(await at(ws, "stay")).toContain("Brooks Guesthouse");
    expect(await at(ws, "everyone")).toContain("in the photo");
    expect(await at(ws, "everyone/1")).toContain("One family");
    expect(await at(ws, "everyone/999")).not.toContain("One family");
    expect(await at(ws, "nowhere")).toContain(`<b aria-current="page">${code}</b>`); // the box
    ws.close();
  });

  test("find dims what the word misses, keeps lit what it hits, tallies, and forgets on close (rule 17)", async () => {
    const ws = await enter(code);
    const guests = (await household(code)).guests;
    await at(ws, "guests"); // find is on the guests' window

    // opening find: the field appears, empty, dimming nobody
    let html = await go(ws, [{ op: "replace", path: "/filter/guests", value: "" }]);
    expect(html).toContain('class="filter"');
    expect(html).not.toContain(" hushed");

    // typing dims what the word misses, keeps the rest lit, and tallies -- in both readings
    html = await go(ws, [{ op: "replace", path: "/filter/guests", value: guests[0]!.name }]);
    expect(html).toContain(`&quot;hushed&quot;:true`); // the photo applet's own props, one entry hushed
    const waiting = (await household(code)).asks.filter((a) => a.reply === null).length;
    expect(html).toContain(`>1 of ${guests.length + waiting}</span>`);
    html = await go(ws, [{ op: "replace", path: "/reading/guests", value: "list" }]);
    expect(html).toContain('class="row tap hushed"');

    // a waiting ask hushes too, by its own name, when the word misses it
    await asHousehold(code, [{ op: "add", path: "/asks/-", value: "Nobody Matching" }]);
    expect(await at(ws, "guests")).toContain('class="row hushed"');

    // closing find forgets the word: nothing dims, no field, no tally
    html = await go(ws, [{ op: "remove", path: "/filter/guests" }]);
    expect(html).not.toContain('class="filter"');
    expect(html).not.toContain(" hushed");
    expect(html).not.toContain('class="tally"');

    // the gifts collection carries find too, once open, dimming its own rows
    await at(ws, "gifts");
    html = await go(ws, [{ op: "replace", path: "/filter/gifts", value: (await board()).gifts[0]!.name }]);
    expect(html).toContain('class="filter"');
    expect(html).toContain('class="row tap hushed"');
    ws.close();
  });

  test("undo walks back this session's own writes, newest first; nothing left, nothing moves", async () => {
    const ws = await enter(code);
    const guest = (await household(code)).guests[0]!;
    await send(ws, "household", [{ op: "replace", path: `/guests/${guest.id}/minifigure/top`, value: "#7FAE4E" }]);
    await send(ws, "household", [{ op: "add", path: "/claims/-", value: 3 }]);
    expect((await household(code)).claims).toContain(3);

    let h = await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "remove", path: `/claims/3-${hid}` }] });
    expect((await household(code)).claims).not.toContain(3);

    h = await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "replace", path: `/guests/${guest.id}`, value: { top: guest.minifigure.top, built_at: guest.minifigure.built_at } }] });
    expect((await household(code)).guests[0]!.minifigure).toEqual(guest.minifigure);

    // nothing of this session's left to undo: the page, nothing told
    await refused(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    ws.close();
  });

  test("a look or a choice goes out as the parts that show that guest, per viewer, and nothing to anyone else", async () => {
    const guest = (await household(code)).guests[0]!;
    const answered = (await household(code)).answer;
    await asHousehold(code, [{ op: "replace", path: "/answer", value: "yes" }]); // in the photo of everyone
    const mine = await enter(code);
    const list = await enter(code);
    const everyone = await enter("OKAFOR");
    const elsewhere = await enter("OKAFOR");
    const couple = await enter("DASH");
    const family = await enter("DASH");
    const familyBox = await enter("DASH");
    const home = await enter("DASH");
    const welcome = connect(); // no code yet
    await opened(welcome);
    await heard(welcome);
    await at(mine, `guests?guest=${guest.id}`);
    await go(list, [{ op: "replace", path: "/page", value: "guests" }, { op: "replace", path: "/reading/guests", value: "list" }]);
    await at(everyone, "everyone");
    await at(elsewhere, "gifts");
    await at(couple, "households");
    await at(family, `households/${hid}/guests`);
    await at(familyBox, `households/${hid}`);

    // an applet's mount has nothing inside it, so a look goes as its tag alone -- the new props.
    // a look: the family photo and the open drawer's dress for the household, the photo of
    // everyone, the board's and the family's photos for the couple, the home's small reading
    const look = await send(mine, "household", [{ op: "replace", path: `/guests/${guest.id}/minifigure/hair`, value: "curls" }]);
    expect(look.targets).toEqual(["tag family-photo", `tag dress-${guest.id}`]);
    expect((await heard(list)).targets).toEqual([]); // the list reading shows no looks
    const e = await heard(everyone);
    expect(e.patches.map((p) => p.doc)).toEqual(["everyone:1"]); // what everyone may see, and no more
    expect(e.targets).toEqual(["tag everyone-photo"]); // they are coming, so in it
    expect((await heard(elsewhere)).renders).toEqual([]); // told, but nothing on its page shows it
    expect((await heard(couple)).targets).toEqual(["tag board-photo"]);
    expect((await heard(family)).targets).toEqual(["tag family-photo"]);
    expect((await heard(familyBox)).targets).toEqual(["tag family-mini"]); // the family box's small reading of them, still
    expect((await heard(home)).targets).toEqual(["tag board-mini"]); // the home's small reading of the families, still
    const w = await heard(welcome);
    expect([...w.patches, ...w.renders]).toEqual([]); // a visitor reads the welcome, which no household moves

    // a choice: the drawer's menu and the list's row for the household, the family's row for the couple, nothing for the photos
    await go(family, [{ op: "replace", path: `/reading/family-${hid}`, value: "list" }]);
    expect((await send(mine, "household", [{ op: "replace", path: `/guests/${guest.id}/choices/2/dish`, value: 5 }])).targets).toEqual([`tag menu-${guest.id}`]);
    expect((await heard(list)).targets).toEqual([`replace guest-${guest.id}`]);
    const e2 = await heard(everyone);
    expect([...e2.patches, ...e2.renders]).toEqual([]); // a choice is not everyone's to see
    expect((await heard(couple)).targets).toEqual([]);
    expect((await heard(family)).targets).toEqual([`replace guest-${guest.id}`]);
    expect((await heard(familyBox)).targets).toEqual([]); // a choice shows in no small reading

    // anything else goes out the same way: what shows it, to whoever's page shows it
    expect((await send(mine, "household", [{ op: "replace", path: "/message", value: "a message" }])).page).toContain("a message");
    const quiet = await heard(elsewhere);
    expect([...quiet.patches, ...quiet.renders]).toEqual([]);

    for (const ws of [mine, list, everyone, elsewhere, couple, family, familyBox, home, welcome]) ws.close();
    await asHousehold(code, [{ op: "remove", path: `/guests/${guest.id}/choices/2/dish` }, { op: "replace", path: `/guests/${guest.id}/minifigure/hair`, value: guest.minifigure.hair }]);
    await asHousehold(code, [answered === null ? { op: "remove", path: "/answer" } : { op: "replace", path: "/answer", value: answered }]);
  });

  test("inspect reports what this connection sees: its session, its household, what it read of the wedding -- never the board", async () => {
    const ws = await enter(code);
    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await nextMessage(ws);
    expect(inspection.docs!.map((d) => d.doc)).toEqual(["session", householdDoc(), "wedding:1", "everyone:1"]);
    ws.close();
  });
});

describe("the couple", () => {
  test("the couple's code opens the home, the households, a family, its asks, and the four lists", async () => {
    const ws = await enter("DASH");
    expect(held.get(ws)).toContain('class="bubble couple thing"'); // entered at home
    // the welcome is a "thing" (rule 15): ✎ opens its own drawer, where its picture lives
    expect(await at(ws, "?answer")).toContain('data-applet="picture-field"');
    await at(ws, "");
    const households = await at(ws, "households");
    expect(households).toContain("Invite a household");
    expect(households).toContain('data-applet="photo"');
    expect(await go(ws, [{ op: "replace", path: "/reading/households", value: "list" }])).toContain('class="row tap"');
    // the code is a thing (rule 15): its drawer holds the email, the plus-ones and the way to chase them
    const family = await at(ws, `households/${hid}?keep=households/${hid}`);
    expect(family).toContain("Plus-ones");
    expect(family).toContain("Chase them");
    await at(ws, `households/${hid}`);
    expect(await at(ws, "households/2/asks")).toContain("They have not asked for anyone."); // Ben, who never has
    expect(await at(ws, "households/999999")).toContain("Invite a household");
    for (const table of ["courses", "gifts", "events", "places"]) expect(await at(ws, table)).toContain("Add a ");
    const drawer = await at(ws, "courses?keep=courses/1");
    expect(drawer).toContain("Add a dish");
    expect(drawer).toContain("Remove this course");
    expect(await at(ws, "gifts?keep=gifts/2")).toContain('aria-label="Shared: any number may claim it"');
    expect(await at(ws, "events?keep=events/1")).toContain("2027-04-02T13:00");
    expect(await at(ws, "places?keep=places/1")).toContain("how far, how to book");
    expect(await at(ws, "places?keep=nope/1")).not.toContain("keep-sheet");

    // adding is a plus on the collection's rail and a modal asking one question, the name; the
    // page behind it is inert while it asks (rule 14)
    let html = await at(ws, "courses?new=courses");
    expect(html).toContain('<dialog open class="modal" aria-label="Add a course">');
    expect(html).toContain("The course&#39;s name");
    expect(html).toContain('class="ground" inert>');
    html = (await send(ws, "board", [{ op: "add", path: "/courses/-", value: "Pudding" }])).page;
    const pudding = (await board()).courses.find((c) => c.name === "Pudding")!;
    expect(pudding).toBeTruthy();
    // the write that answers the question closes the modal
    expect(html).not.toContain('class="modal"');
    expect(html).not.toContain(`class="ground" inert`);

    // removing asks in a modal too -- a modal is new or delete and nothing else (rule 14)
    expect(await at(ws, `courses?confirm=courses/${pudding.id}`)).toContain(`Remove &quot;Pudding&quot; from the list?`);
    expect((await send(ws, "board", [{ op: "remove", path: `/courses/${pudding.id}` }])).page).not.toContain('class="modal"');
    expect((await board()).courses.some((c) => c.id === pudding.id)).toBe(false);
    // a stale or nonsense confirm target renders no modal at all
    expect(await at(ws, "courses?confirm=courses/999999")).not.toContain('class="modal"');
    expect(await at(ws, "courses?confirm=nope/1")).not.toContain('class="modal"');
    ws.close();
  });

  test("the lists are the couple's to keep: a move renumbers, a field takes its kind, a course taken off takes its choices with it", async () => {
    const ws = await enter("DASH");
    const names = async () => (await board()).courses.map((c) => c.name);
    const before = await names();
    await send(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: 1 }]);
    expect(await names()).toEqual([before[3], ...before.slice(0, 3)]);
    await refused(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: 1 }]); // already there: nothing moves
    await refused(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: "top" }]);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await names()).toEqual(before);

    // a gift is shared or not, however a form spells it; a name may not be blanked; a date must be one
    await send(ws, "board", [{ op: "replace", path: "/gifts/3/shared", value: "on" }]);
    expect((await board()).gifts.find((g) => g.id === 3)!.shared).toBe(true);
    await send(ws, "board", [{ op: "remove", path: "/gifts/3/shared" }]);
    await refused(ws, "board", [{ op: "replace", path: "/gifts/3/name", value: "  " }]);
    await refused(ws, "board", [{ op: "replace", path: "/day", value: "someday" }]);

    // a dish chosen, then the course taken off: the choice goes with it, and undo brings both back
    await asHousehold(code, [{ op: "replace", path: `/guests/${(await household(code)).guests[0]!.id}/choices/3/dish`, value: 7 }]);
    const choices = () => household(code).then((h) => h.guests[0]!.choices);
    expect((await choices())["3"]).toEqual({ dish: 7, drink: null });
    await send(ws, "board", [{ op: "remove", path: "/courses/3/dishes/7" }]);
    expect((await choices())["3"]).toEqual({ dish: null, drink: null });
    await send(ws, "board", [{ op: "remove", path: "/courses/3" }]);
    expect((await choices())["3"]).toBeUndefined();
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await choices())["3"]).toEqual({ dish: 7, drink: null });
    expect((await board()).courses.find((c) => c.id === 3)!.dishes.map((d) => d.id)).toEqual([7, 8]);

    // a gift taken off takes its claims with it
    await asHousehold(code, [{ op: "add", path: "/claims/-", value: 2 }]);
    await send(ws, "board", [{ op: "remove", path: "/gifts/2" }]);
    expect((await household(code)).claims).not.toContain(2);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await household(code)).claims).toContain(2);
    await asHousehold(code, [{ op: "remove", path: "/claims/2" }, { op: "remove", path: `/guests/${(await household(code)).guests[0]!.id}/choices/3/dish` }]);
    ws.close();
  });

  test("find dims households and the couple's own gifts, keeps lit what it hits, and tallies (rule 17)", async () => {
    // two households this test alone owns, so the asks it adds disturb no one else's
    const stamp = Date.now();
    for (const who of ["findme", "other"]) await asCouple([{ op: "add", path: "/households/-", value: { email: `${who}-${stamp}@example.com`, names: `${who} ${stamp}` } }]);
    const ws = await enter("DASH");
    const households = (await board()).households;
    const matching = households.find((h) => h.email === `findme-${stamp}@example.com`)!;
    const other = households.find((h) => h.email === `other-${stamp}@example.com`)!;

    // households, the photo reading: opening find dims the family the word misses
    await at(ws, "households");
    let html = await go(ws, [{ op: "replace", path: "/filter/households", value: matching.code }]);
    expect(html).toContain('class="filter"');
    expect(html).toContain(`&quot;hushed&quot;:true`);
    expect(html).toContain(`>1 of ${households.length}</span>`);

    // the list reading: the same word hushes the row, and any of its own waiting asks
    await asHousehold(matching.code, [{ op: "add", path: "/asks/-", value: "Someone Matching" }]);
    await asHousehold(other.code, [{ op: "add", path: "/asks/-", value: "Someone Else" }]);
    html = await go(ws, [{ op: "replace", path: "/reading/households", value: "list" }]);
    expect(html).toContain(`class="row tap hushed" id="household-${other.id}"`);
    expect(html).toContain(`class="row tap" id="household-${matching.id}"`); // the matching household, not hushed
    expect(html).toMatch(/\d+ asks? waiting/); // its waiting ask rides on its row as a note, not a row of its own
    await go(ws, [{ op: "remove", path: "/filter/households" }]);

    // the couple's own gifts, kept: find dims the same way
    await at(ws, "gifts");
    const gifts = (await board()).gifts;
    html = await go(ws, [{ op: "replace", path: "/filter/gifts", value: gifts[0]!.name }]);
    expect(html).toContain('class="filter"');
    expect(html).toContain('class="row tap hushed"');
    expect(html).toContain(`>1 of ${gifts.length}</span>`);
    ws.close();
  });

  test("a family's box reads its guests as the photo or the list, and its asks once answered", async () => {
    const ws = await enter("DASH");
    const guest = (await household(code)).guests[0]!.id;
    await asHousehold(code, [{ op: "replace", path: `/guests/${guest}/coming`, value: 1 }, { op: "add", path: "/asks/-", value: "Answered" }, { op: "add", path: "/asks/-", value: "Waiting" }]);
    const ask = (await household(code)).asks.find((a) => a.name === "Answered")!;
    await asCouple([{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "no" }]);
    const list = await go(ws, [{ op: "replace", path: "/page", value: `households/${hid}/guests` }, { op: "replace", path: `/reading/family-${hid}`, value: "list" }]);
    expect(list).toContain(">coming</span>");
    expect(list).toContain(">not said</span>");
    const asks = await at(ws, `households/${hid}/asks`);
    expect(asks).toContain("Answered");
    expect(asks).toContain('class="answer-word no"');
    expect(asks).toContain(">Waiting</span>"); // the waiting ask's row carries the couple's yes or no
    expect(asks).toContain('class="pick" role="radiogroup" aria-label="'); // the couple's yes or no, one choice
    await asHousehold(code, [{ op: "remove", path: `/guests/${guest}/coming` }]);
    ws.close();
  });

  test("beyond sixteen in the photo, everyone sees the families, one figure each with its count, and a family opens", async () => {
    const couple = await enter("DASH");
    const email = `crowd-${Date.now()}@example.com`;
    const names = Array.from({ length: 17 }, (_, i) => `Guest${i}`).join(",");
    await send(couple, "board", [{ op: "add", path: "/households/-", value: { email, names } }]);
    const crowd = (await board()).households.find((h) => h.email === email)!;
    await asHousehold(crowd.code, [{ op: "replace", path: "/answer", value: "yes" }]);
    const ws = await enter(crowd.code);
    const families = await at(ws, "everyone");
    expect(families).toContain("Tap a family to see them");
    expect(families).toContain("&quot;count&quot;:17");
    expect(await at(ws, `everyone/${crowd.id}`)).toContain("One family, 17 of them.");
    ws.close();
    await heard(couple);
    await send(couple, "ledger", [{ op: "remove", path: "/latest" }]); // the crowd goes home
    couple.close();
  });

  test("a yes to an ask makes a guest the household sees; the couple's undo takes it back; a household may not reply", async () => {
    const couple = await enter("DASH");
    const tab = await enter(code);
    await send(tab, "household", [{ op: "add", path: "/asks/-", value: "Friend" }]);
    expect((await heard(couple)).page).toMatch(/\d+ asks? waiting/);
    const ask = (await household(code)).asks.at(-1)!;

    await refused(tab, "board", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "yes" }]);

    expect((await send(couple, "board", [{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "yes" }])).patches[0]).toMatchObject({ doc: "board:1" });
    const told = await heard(tab);
    expect(told.patches.map((p) => p.doc)).toContain(householdDoc()); // the reply, and the guest it made, reach the household's own document
    expect(told.page).toContain("Friend");
    expect((await household(code)).guests.map((g) => g.name)).toContain("Friend");

    expect((await send(couple, "ledger", [{ op: "remove", path: "/latest" }])).patches[0]).toMatchObject({ doc: "board:1" });
    expect((await heard(tab)).page).not.toContain(">Friend<");
    expect((await household(code)).guests.map((g) => g.name)).not.toContain("Friend");
    couple.close();
    tab.close();
  });

  test("an invitation, and its undo, through the wire", async () => {
    const ws = await enter("DASH");
    const email = `wire-${Date.now()}@example.com`;
    await send(ws, "board", [{ op: "add", path: "/households/-", value: { email, names: "Wire Test", plus_ones: "0" } }]);
    const invited = (await board()).households.find((h) => h.email === email)!;
    expect(invited.guests.map((g) => g.name)).toEqual(["Wire Test"]);
    expect(invited.code).toBe(`WIRE-1${invited.id}`); // the email before the @, six letters at most, then the id
    await refused(ws, "board", [{ op: "add", path: "/households/-", value: { email: "no-at-sign" } }]);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await board()).households.find((h) => h.email === email)).toBeUndefined();
    ws.close();
  });

  test("a household's tab whose code stops existing is back at the welcome", async () => {
    const couple = await enter("DASH");
    const email = `gone-${Date.now()}@example.com`;
    await send(couple, "board", [{ op: "add", path: "/households/-", value: email }]);
    const gone = (await board()).households.find((h) => h.email === email)!;
    const tab = await enter(gone.code);
    await send(couple, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await heard(tab)).page).toContain("at-welcome");
    couple.close();
    tab.close();
  });
});

// Undo beside someone else. The ledger is delta's (0.6.0): it applies a write's recorded inverse
// blind, and asks nobody whether the walk is still allowed. These say what should be true, and
// fail today -- bun says so when one starts to pass, and the `.failing` comes off
// (scratchpad cross-repo.md, to delta: guarded inverses; a walk the caller can ask about first).
describe("undo beside someone else", () => {
  const undo = (ws: WebSocket) => send(ws, "ledger", [{ op: "remove", path: "/latest" }]);

  test.failing("one tab takes back its note, and the note another tab wrote after it stays", async () => {
    const mine = await enter(code), theirs = await enter(code);
    await send(mine, "household", [{ op: "replace", path: "/message", value: "Tess is vegetarian." }]);
    await send(theirs, "household", [{ op: "replace", path: "/message", value: "Tom brings a cake." }]);
    await undo(mine);
    try {
      expect((await household(code)).message).toBe("Tom brings a cake.");
    } finally {
      await undo(theirs);
      mine.close();
      theirs.close();
    }
  });

  test.failing("an undo that no longer applies does not stick: the next Undo walks back the write before it", async () => {
    const mine = await enter(code), theirs = await enter(code);
    const answer = (await household(code)).answer;
    await send(mine, "household", [{ op: "replace", path: "/answer", value: answer === "no" ? "yes" : "no" }]);
    await send(mine, "household", [{ op: "add", path: "/claims/-", value: 3 }]);
    await send(theirs, "household", [{ op: "remove", path: "/claims/3" }]); // the claim goes, from the other tab
    await undo(mine); // the claim's undo: nothing left to take back
    await undo(mine);
    try {
      expect((await household(code)).answer).toBe(answer);
    } finally {
      await asHousehold(code, [answer === null ? { op: "remove", path: "/answer" } : { op: "replace", path: "/answer", value: answer }]);
      mine.close();
      theirs.close();
    }
  });

  test.failing("after the deadline an answer is locked, to Undo too", async () => {
    const ws = await enter(code);
    const answer = (await household(code)).answer;
    await send(ws, "household", [{ op: "replace", path: "/answer", value: answer === "maybe" ? "yes" : "maybe" }]);
    const answered = (await household(code)).answer;
    await asCouple([{ op: "replace", path: "/deadline", value: "2020-01-01" }]);
    await heard(ws); // the household's page shows the deadline
    try {
      await refused(ws, "household", [{ op: "replace", path: "/answer", value: "no" }]);
      await undo(ws);
      expect((await household(code)).answer).toBe(answered);
    } finally {
      await asCouple([{ op: "remove", path: "/deadline" }]);
      await asHousehold(code, [answer === null ? { op: "remove", path: "/answer" } : { op: "replace", path: "/answer", value: answer }]);
      ws.close();
    }
  });
});
