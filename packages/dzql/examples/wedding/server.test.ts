import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { connect as socketTo, heard as heardBy, nextMessage, opened, pageOf, type WireMessage } from "../../src/test-socket";
import { decoded } from "../../src/parts";
import { crowd } from "./applets/photo";
import { asCouple, asHousehold, board, household } from "./setup";
import { example } from "./index";
import type { Compartment } from "../../src/compartments/compartment";
import { keepEveryone } from "./everyone";
import { serverWrite } from "../../src/documents";
import { esc } from "../../src/html";

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

/** A socket to the server, as the session the cookie names (a fresh visit without one). */
const connect = (cookie?: string): WebSocket => socketTo(server, cookie?.replace("session_id=", ""));

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
  const messages = await heardBy(ws);
  const renders = messages.filter((m) => m.type === "render");
  const targets = renders.flatMap((r) => ((r.ops ?? []) as { op: string; target?: string }[]).filter((o) => o.target).map((o) => `${o.op} ${/data-eta-part="(.*)"/.exec(o.target!)![1]}`));
  return { patches: messages.filter((m) => m.type === "patch"), renders, page: pageOf(ws), targets };
}

/** A write, and what its own connection was sent for it. */
function send(ws: WebSocket, doc: string, ops: PatchOp[]): Promise<Heard> {
  ws.send(JSON.stringify({ doc, ops }));
  return heard(ws);
}

/** Goes somewhere: a session write, and the page it leads to. */
const go = async (ws: WebSocket, ops: PatchOp[]): Promise<string> => (await send(ws, "session", ops)).page;
const at = (ws: WebSocket, page: string): Promise<string> => go(ws, [{ op: "replace", path: "/page", value: page }]);

/** Refused: nothing applied, nothing told -- and the page it holds not sent again, only a part that says why, if one does. */
async function refused(ws: WebSocket, doc: string, ops: PatchOp[]): Promise<Heard> {
  const h = await send(ws, doc, ops);
  expect(h.patches).toEqual([]);
  expect(h.renders.filter((r) => r.html !== undefined)).toEqual([]);
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
    const ws = await enter("NICK", couple);
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
    // the picture shows in the welcome's own drawer (the couple's welcome is a thing, its picture with it)
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
    expect(page).toContain("Nick");
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
  test("entering a code opens the household's photo, the photo applet given its family; a drawer is a session write; leaving returns to the welcome", async () => {
    const ws = await enter(code);
    const page = await at(ws, "");
    expect(page).toContain(`<span class="cell-name">${code}</span>`);
    expect(page).toContain('id="family-photo" data-applet="photo"');
    expect(page).toContain("Tess");
    const gifts = await at(ws, "?gifts");
    expect(gifts).toContain('aria-label="Gifts"');
    expect(gifts).toContain("Honeymoon fund");
    expect(await go(ws, [{ op: "remove", path: "/code" }])).toContain("at-welcome");
    ws.close();
  });

  test("a write is told to the household's tabs and the couple's; another household hears what everyone may, never the household's own", async () => {
    const mine = await enter(code);
    const other = await enter(code); // a second tab, same household
    const couple = await enter("NICK");
    const stranger = await enter("OKAFOR");
    await at(stranger, "everyone"); // another household sees this one only in the photo of everyone

    const h = await send(mine, "household", [{ op: "replace", path: "/answer", value: "maybe" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "replace", path: "/households/answer", value: "maybe" }] });
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

  test("permit: only the household's own surface, only while answers are open, a plus-one only while one is owed, and an ask only once none is", async () => {
    const ws = await enter(code);
    await refused(ws, "household", [{ op: "replace", path: "/code", value: "X" }]);
    await refused(ws, "household", [{ op: "remove", path: "/guests/1" }]);
    await refused(ws, "household", [{ op: "add", path: "/answer", value: "yes" }]);
    await refused(ws, "board", [{ op: "replace", path: "/name1", value: "X" }]);
    await refused(ws, "nothing", [{ op: "replace", path: "/x", value: "X" }]);

    // one plus-one is owed: the plus names them, in a modal; the first is taken and the
    // modal put away, the second refused, and the plus asks the couple after
    const plus = await at(ws, "?new=guests");
    expect(plus).toContain('aria-label="Name our plus-one"');
    expect(plus).toContain('<dialog open class="modal" aria-label="Name our plus-one">');
    await refused(ws, "household", [{ op: "add", path: "/asks/-", value: "Cousin Vim" }]); // owed a plus-one, they name them: no page asks
    const named = (await send(ws, "household", [{ op: "add", path: "/guests/-", value: "Plus One" }])).page;
    expect(named).toContain("Plus");
    expect(named).not.toContain('class="modal"');
    await refused(ws, "household", [{ op: "add", path: "/guests/-", value: "Plus Two" }]);
    expect(await at(ws, "")).toContain(`aria-label="Ask to bring someone" data-write='{"doc":"session","op":"replace","path":"/page"}' data-value='"?new=asks"'`);

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

  test("the drawers: a guest's (the dress and menu applets), the answer's, and the gifts, the day and where to stay -- each a tool, expanded while its drawer is open", async () => {
    const ws = await enter(code);
    const guest = (await household(code)).guests[0]!;
    let html = await at(ws, `?guest=${guest.id}`);
    expect(html).toContain('data-applet="dress"');
    expect(html).toContain('data-applet="menu"');
    expect(html).toContain(`aria-label="${guest.name}"`);
    html = await at(ws, "?answer");
    expect(html).toContain('aria-label="Our answer"');
    expect(html).toContain(`data-write='{"doc":"household","op":"replace","path":"/answer"}' data-value='"yes"'`);

    // the gifts: each whole, and what this household may do with it; the tool, pressed, puts the drawer away
    html = await at(ws, "?gifts");
    expect(html).not.toContain('data-applet="dress"');
    expect(html).toContain(`aria-label="Gifts" aria-expanded="true" data-write='{"doc":"session","op":"replace","path":"/page"}' data-value='""'`);
    expect(html).toContain("Le Creuset casserole");
    expect(html).toContain(`data-write='{"doc":"household","op":"add","path":"/claims/-"}' data-value='1'`);
    // the honeymoon fund, shared, given to by nobody yet: its control says anyone may give, and nothing says it again
    expect(html).toContain("Give to it");
    expect(html).not.toContain("anyone may");
    expect(html).not.toContain(">open</span>");
    // claimed: it is ours to unclaim; shared, another household's giving is counted, never named
    const email = `giver-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Gil Giver" } }]);
    const other = (await board()).households.find((x) => x.email === email)!;
    await asHousehold(other.code, [{ op: "add", path: "/claims/-", value: 2 }, { op: "add", path: "/claims/-", value: 3 }]);
    html = (await send(ws, "household", [{ op: "add", path: "/claims/-", value: 1 }])).page;
    expect(html).toContain('<span class="state-yes">claimed by us</span>');
    expect(html).toContain('data-write=\'{"doc":"household","op":"remove","path":"/claims/1"}\'');
    expect(html).toContain(">1 household has given</span>");
    expect(html).toContain('<span class="state-no">taken</span>'); // the knives, not shared, the other household's
    await send(ws, "household", [{ op: "remove", path: "/claims/1" }]);
    await asHousehold(other.code, [{ op: "remove", path: "/claims/2" }, { op: "remove", path: "/claims/3" }]); // the gifts as the other tests find them

    html = await at(ws, "?day");
    expect(html).toContain('aria-label="The day"');
    expect(html).toContain("Ceremony");
    // the day's own place is said once, at its head: an event there does not say it again
    expect(html).toContain("<br>The Mount Without, Bristol</p>");
    expect(html).not.toContain('<span class="note">The Mount Without</span>');
    html = await at(ws, "?stay");
    expect(html).toContain('aria-label="Where to stay"');
    expect(html).toContain("Brooks Guesthouse");
    ws.close();
  });

  test("the page read three ways: the photo, the list with whoever was asked for, everyone (and one family); a page that does not exist is the photo", async () => {
    const ws = await enter(code);
    // a waiting ask stands in the photo as a ghost, still: nothing of theirs to open
    await asHousehold(code, [{ op: "add", path: "/asks/-", value: "Robin Friend" }]);
    const askId = (await household(code)).asks.at(-1)!.id;
    expect(await at(ws, "")).toContain(`{&quot;key&quot;:&quot;ask-${askId}&quot;,&quot;ghost&quot;:true`);
    // the reading is a radio of three: chosen is aria-checked, never aria-pressed, which is a toggle's
    const reading = /<div class="stack" role="radiogroup" aria-label="Read as">.*?<\/div>/.exec(await at(ws, "list"))![0];
    expect(reading).toContain('role="radio" aria-checked="true" aria-label="List"');
    expect(reading).not.toContain("aria-pressed");
    // the list: the guests' rows, then whoever was asked for and is not a guest; a surname the family shares is said once
    let html = await at(ws, "list");
    expect(html).toContain('class="row tap"');
    expect(html).toContain('<span class="what">Tess Test</span>');
    expect(html).toContain('<span class="what">Tom</span>');
    expect(html).toContain('<span class="what">Robin Friend</span>');
    expect(html).toContain(">asked for</span>");
    await asCouple([{ op: "replace", path: `/households/${hid}/asks/${askId}/reply`, value: "no" }]);
    expect((await heard(ws)).page).toContain(">the couple said no</span>");
    // the photo every household watches, and one family in it
    expect(await at(ws, "everyone")).toContain("in the photo");
    html = await at(ws, "everyone/1");
    expect(html).toContain('<span class="cell-name">One family</span>');
    expect(await at(ws, "everyone/999")).not.toContain("One family");
    expect(await at(ws, "nowhere")).toContain('id="family-photo"');
    ws.close();

    // a household nobody is named on yet: the photo says so
    const couple = await enter("NICK");
    const nobody = `empty-${Date.now()}@example.com`;
    await send(couple, "board", [{ op: "add", path: "/households/-", value: nobody }]);
    const empty = await enter((await board()).households.find((x) => x.email === nobody)!.code);
    expect((await heard(empty)).page).toContain("Nobody is named on your invitation yet.");
    await send(couple, "ledger", [{ op: "remove", path: "/latest" }]);
    empty.close();
    couple.close();
  });

  test("find looks for someone by name in the photo and the list: fades whoever it misses, tallies, the eye takes them out, and it forgets on close", async () => {
    const ws = await enter(code);
    const guests = (await household(code)).guests;
    const [found, missed] = [guests[0]!, guests[1]!];
    await at(ws, "");

    // opening find: the field, empty, dimming nobody
    let html = await go(ws, [{ op: "replace", path: "/filter/guests", value: "" }]);
    expect(html).toContain('class="filter"');
    expect(html).not.toContain("&quot;hushed&quot;:true");

    // a word: the photo dims whoever it misses, and the tally counts the people this reading shows
    html = await go(ws, [{ op: "replace", path: "/filter/guests", value: found.name }]);
    expect(html).toContain(`&quot;key&quot;:&quot;${missed.id}&quot;`);
    expect(html).toContain("&quot;hushed&quot;:true");
    const waiting = (await household(code)).asks.filter((a) => a.reply === null).length;
    expect(html).toContain(`>1 of ${guests.length + waiting}</span>`);
    // the eye: whoever it misses steps out of the photo
    html = await go(ws, [{ op: "replace", path: "/hide/guests", value: true }]);
    expect(html).not.toContain(`&quot;key&quot;:&quot;${missed.id}&quot;`);
    expect(html).toContain(`&quot;key&quot;:&quot;${found.id}&quot;`);

    // the list: the same word, the same eye; someone asked for is found by their own name
    await asHousehold(code, [{ op: "add", path: "/asks/-", value: "Nobody Matching" }]);
    html = await at(ws, "list");
    expect(html).toMatch(new RegExp(`class="row tap hushed" id="guest-${missed.id}"[^>]* hidden>`));
    expect(html).toMatch(/class="row hushed" id="ask-\d+" hidden>/);
    expect(html).toContain(`class="row tap" id="guest-${found.id}"`);

    // everyone's photo is nameless until the day: no find there, and the word waits for the way back
    expect(await at(ws, "everyone")).not.toContain('class="filter"');
    expect(await at(ws, "")).toContain(`value="${found.name}"`);

    // closing find forgets the word and the eye: nothing dims, no field, no tally
    html = await go(ws, [{ op: "remove", path: "/filter/guests" }]);
    expect(html).not.toContain('class="filter"');
    expect(html).not.toContain("&quot;hushed&quot;:true");
    expect(html).toContain(`&quot;key&quot;:&quot;${missed.id}&quot;`);
    ws.close();
  });

  test("the mark at each guest's feet says whether they are coming: their own word where they said it, else the household's answer", async () => {
    const stamp = Date.now();
    const email = `marks-${stamp}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: `Ann ${stamp}, Bo ${stamp}, Cy ${stamp}` } }]);
    const h = (await board()).households.find((x) => x.email === email)!;
    const [ann, bo, cy] = h.guests.map((g) => String(g.id));
    const ws = await enter(h.code);
    const marks = (html: string) => {
      const props = /id="family-photo" data-applet="photo" data-props="([^"]*)"/.exec(html)![1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
      return Object.fromEntries((JSON.parse(props).entries as { key: string; mark?: string }[]).map((e) => [e.key, e.mark]));
    };
    expect(marks(await at(ws, ""))).toEqual({ [ann!]: "none", [bo!]: "none", [cy!]: "none" });

    await asHousehold(h.code, [
      { op: "replace", path: "/answer", value: "maybe" },
      { op: "replace", path: `/guests/${ann}/coming`, value: "yes" },
      { op: "replace", path: `/guests/${bo}/coming`, value: "no" },
    ]);
    expect(marks((await heard(ws)).page)).toEqual({ [ann!]: "yes", [bo!]: "no", [cy!]: "maybe" });

    // a household's no speaks for whoever has not said
    await asHousehold(h.code, [{ op: "replace", path: "/answer", value: "no" }]);
    expect(marks((await heard(ws)).page)).toEqual({ [ann!]: "yes", [bo!]: "no", [cy!]: "no" });
    ws.close();
  });

  test("everyone is kept one run at a time: two at once write the difference once, and neither is refused", async () => {
    const doc = "everyone:1";
    const inDelta = example.delta!.as("test");
    const { _v, ...before } = (await inDelta.call("open", { doc })).result;
    await serverWrite(doc, [{ op: "add", path: "/figures/ghost", value: { household: "0", ghost: true, look: {} } }]); // held, and nobody
    // each run diffs the copy it reads: at once, both would take the ghost out, and delta refuses
    // the second remove (404), and the rest of its batch with it
    await Promise.all([keepEveryone(), keepEveryone()]);
    expect((await inDelta.call("open", { doc })).result).toEqual({ ...before, _v: _v + 2 }); // the ghost in, and out once
  });

  test("undo walks back this session's own writes, newest first, saying what each took back; nothing left, nothing moves", async () => {
    const ws = await enter(code);
    const guest = (await household(code)).guests[0]!;
    await send(ws, "household", [{ op: "replace", path: `/guests/${guest.id}/minifigure/top`, value: "#7FAE4E" }]);
    await send(ws, "household", [{ op: "add", path: "/claims/-", value: 3 }]);
    expect((await household(code)).claims).toContain(3);

    let h = await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "remove", path: `/claims/3-${hid}` }] });
    expect((await household(code)).claims).not.toContain(3);
    const said = (words: string) => `<div data-eta-part="undo-said" class="undo-said"><p class="said" role="status">${esc(words)}</p></div>`; // over the page, where Undo is
    expect(h.page).toContain(said("Undone: claiming “A set of good knives”."));
    expect(h.renders.map((r) => r.html)).toEqual([undefined]); // what it says goes as a part of its own: the page is not sent whole for it

    h = await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(h.patches[0]).toMatchObject({ doc: householdDoc(), ops: [{ op: "replace", path: `/guests/${guest.id}/built_at`, value: guest.minifigure.built_at }, { op: "replace", path: `/guests/${guest.id}/top`, value: guest.minifigure.top }] });
    expect((await household(code)).guests[0]!.minifigure).toEqual(guest.minifigure);
    expect(h.page).toContain(said(`Undone: ${guest.name}'s look.`));

    h = await send(ws, "ledger", [{ op: "add", path: "/latest" }]);
    expect(h.page).toContain(said(`Redone: ${guest.name}'s look.`));
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);

    // nothing of this session's left to undo: nothing moves, and what the last undo said goes
    h = await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(h.patches.map((p) => p.doc)).toEqual(["told"]);
    expect(h.page).not.toContain("undo-said");
    await refused(ws, "ledger", [{ op: "remove", path: "/latest" }]); // and then, told nothing, the page as it was
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
    const couple = await enter("NICK");
    const family = await enter("NICK");
    const welcome = connect(); // no code yet
    await opened(welcome);
    await heard(welcome);
    await at(mine, `?guest=${guest.id}`);
    await at(list, "list");
    await at(everyone, "everyone");
    await at(elsewhere, "?gifts");
    await at(family, `?family=${hid}`);

    // an applet's mount has nothing inside it, so a look goes as its tag alone -- the new props.
    // a look: the family photo and the open drawer's dress for the household, the couple's photo
    // of families (under a family's drawer too); the photo of everyone, which watches its document,
    // nothing but the patch
    const look = await send(mine, "household", [{ op: "replace", path: `/guests/${guest.id}/minifigure/hair`, value: "curls" }]);
    expect(look.targets).toEqual(["tag family-photo", `tag dress-${guest.id}`]);
    expect((await heard(list)).targets).toEqual([]); // the list reading shows no looks
    const e = await heard(everyone);
    expect(e.patches.map((p) => p.doc)).toEqual(["everyone:1"]); // what everyone may see, and no more
    expect(e.targets).toEqual([]); // they are coming, so in it: the photo watches everyone, and takes the patch alone
    expect((await heard(elsewhere)).renders).toEqual([]); // told, but nothing on its page shows it
    expect((await heard(couple)).targets).toEqual(["tag board-photo"]);
    expect((await heard(family)).targets).toEqual(["tag board-photo"]);
    const w = await heard(welcome);
    expect([...w.patches, ...w.renders]).toEqual([]); // a visitor reads the welcome, which no household moves

    // a choice: the drawer's menu and the list's row for the household, the guest's line in the family's drawer for the couple, nothing for the photos
    expect((await send(mine, "household", [{ op: "replace", path: `/guests/${guest.id}/choices/2/dish`, value: 5 }])).targets).toEqual([`tag menu-${guest.id}`]);
    expect((await heard(list)).targets).toEqual([`replace guest-${guest.id}`]);
    const e2 = await heard(everyone);
    expect([...e2.patches, ...e2.renders]).toEqual([]); // a choice is not everyone's to see
    expect((await heard(couple)).targets).toEqual([]);
    expect((await heard(family)).targets).toEqual([`replace guest-${guest.id}`]);

    // anything else goes out the same way: what shows it, to whoever's page shows it
    expect((await send(mine, "household", [{ op: "replace", path: "/message", value: "a message" }])).page).toContain("a message");
    const quiet = await heard(elsewhere);
    expect([...quiet.patches, ...quiet.renders]).toEqual([]);

    for (const ws of [mine, list, everyone, elsewhere, couple, family, welcome]) ws.close();
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
  test("the couple's code opens the photo of families; a family, the welcome, the four lists and a row of each are drawers; a new one is named in place; a removal asks first, then goes back to its list", async () => {
    const ws = await enter("NICK");
    expect(pageOf(ws)).toContain('class="bubble couple thing"'); // the welcome, over the photo
    expect(pageOf(ws)).toContain('id="board-photo" data-applet="photo"');
    // the welcome is a "thing": ✎ opens its own drawer, where its picture lives
    expect(await at(ws, "?answer")).toContain('data-applet="picture-field"');
    expect(await at(ws, "list")).toContain(`class="row tap" id="household-${hid}"`); // the other reading: a household a row

    // a family's drawer: their guests (a new one named in place), their invitation, the way to chase them; the plus invites
    let html = await at(ws, `?family=${hid}`);
    expect(html).toContain(`class="drawer family-drawer" role="dialog" aria-label="${code}"`);
    expect(html).toContain(`data-write='{"doc":"board","op":"add","path":"/households/${hid}/guests/-"}'`);
    expect(html).toContain("Plus-ones");
    expect(html).toContain("Chase them");
    expect(await at(ws, "?family=999999")).not.toContain('class="drawer');
    expect(await at(ws, "list?new=households")).toContain('<dialog open class="modal" aria-label="Invite a household">');

    // the four lists: a tool each, expanded while its drawer is open, and a new one named at the foot
    for (const table of ["courses", "gifts", "events", "places"]) {
      html = await at(ws, `?${table}`);
      expect(html).toContain(`id="${table}-drawer"`);
      expect(html).toContain(`data-write='{"doc":"board","op":"add","path":"/${table}/-"}'`);
    }
    // a row's own drawer: its × goes back to its list, whose tool stays expanded
    html = await at(ws, "?keep=courses/1");
    expect(html).toContain("Add a dish");
    expect(await at(ws, "?events")).toContain("Add an event");
    expect(html).toContain("Remove this course");
    expect(html).toContain(`aria-label="Courses" aria-expanded="true"`);
    expect(html).toContain(`aria-label="Close" data-escape data-write='{"doc":"session","op":"replace","path":"/page"}' data-value='"?courses"'`);
    expect(await at(ws, "?keep=gifts/2")).toContain('aria-label="Shared: any number may claim it"');
    expect(await at(ws, "?keep=events/1")).toContain("2027-04-02T13:00");
    expect(await at(ws, "?keep=places/1")).toContain("how far, how to book");
    expect(await at(ws, "?keep=nope/1")).not.toContain("keep-drawer");
    expect(await at(ws, "?keep=courses/999999")).not.toContain("keep-drawer");

    // named in place: the list's drawer stays open, with the new row in it
    await at(ws, "?courses");
    html = (await send(ws, "board", [{ op: "add", path: "/courses/-", value: "Pudding" }])).page;
    const pudding = (await board()).courses.find((c) => c.name === "Pudding")!;
    expect(html).toContain(`id="course-${pudding.id}"`);
    expect(html).toContain('id="courses-drawer"');

    // removing asks in a modal -- a modal is new or delete and nothing else; answered, back to the list
    html = await at(ws, `?confirm=courses/${pudding.id}`);
    expect(html).toContain('<dialog open class="modal" aria-label="Pudding"><h3>Pudding</h3><p class="note">Remove it from the list?</p>'); // named once, then asked
    expect(html).toContain('class="ground" inert>');
    html = (await send(ws, "board", [{ op: "remove", path: `/courses/${pudding.id}` }])).page;
    expect(html).not.toContain('class="modal"');
    expect(html).toContain('data-page="?courses"');
    expect((await board()).courses.some((c) => c.id === pudding.id)).toBe(false);
    // a stale or nonsense confirm target renders no modal at all
    for (const target of ["courses/999999", "nope/1", `households/${hid}/guests/999999`, "households/999999/guests/1"]) expect(await at(ws, `?confirm=${target}`)).not.toContain('class="modal"');
    ws.close();
  });

  test("the venues are a page nobody wrote, drawn from their shape: a row each, its drawer, a new one asked for in a modal; a removal asks first, then goes back to the page", async () => {
    const ws = await enter("NICK");
    expect(pageOf(ws)).toContain(`aria-label="Venues" data-write='{"doc":"session","op":"replace","path":"/page"}' data-value='"venues"'`); // a tool on the couple's rail
    let html = await at(ws, "venues?row=1");
    expect(html).toContain(`<span class="what">The Mount Without</span>`);
    expect(html).toContain(`id="venues-drawer"`);
    expect(html).toContain(`data-applet="picture-field"`); // the picture, by the applet delta.ts names
    await at(ws, "venues?new");
    html = (await send(ws, "board", [{ op: "add", path: "/venues/-", value: "Arnos Vale" }])).page;
    expect(html).toContain('data-page="venues"'); // answered, the modal is put away
    const made = /id="venues-(\d+)"[^>]*><span class="words"><span class="what">Arnos Vale</.exec(html)![1];
    expect(await at(ws, `venues?confirm=${made}`)).toContain(`<h3>Arnos Vale</h3>`);
    html = (await send(ws, "board", [{ op: "remove", path: `/venues/${made}` }])).page;
    expect(html).toContain('data-page="venues"');
    expect(html).not.toContain("Arnos Vale");
    ws.close();
  });

  test("the lists are the couple's to keep: a move renumbers, a field takes its kind, a course taken off takes its choices with it", async () => {
    const ws = await enter("NICK");
    const names = async () => (await board()).courses.map((c) => c.name);
    const before = await names();
    await send(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: 1 }]);
    expect(await names()).toEqual([before[3], ...before.slice(0, 3)]);
    await refused(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: 1 }]); // already there: nothing moves
    await refused(ws, "board", [{ op: "replace", path: "/courses/4/seq", value: "top" }]);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await names()).toEqual(before);

    // a gift is shared or not, however a form spells it; a name may not be blanked; a date must be one
    await send(ws, "board", [{ op: "replace", path: "/gifts/3/shared", value: true }]);
    expect((await board()).gifts.find((g) => g.id === 3)!.shared).toBe(true);
    await send(ws, "board", [{ op: "replace", path: "/gifts/3/shared", value: "off" }]);
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

  test("find looks for a family by its code or a name: fades the rest in the photo and the list, tallies, and the eye takes them out", async () => {
    // two households this test alone owns, so the asks it adds disturb no one else's
    const stamp = Date.now();
    for (const who of ["findme", "other"]) await asCouple([{ op: "add", path: "/households/-", value: { email: `${who}-${stamp}@example.com`, names: `${who} ${stamp}` } }]);
    const ws = await enter("NICK");
    const households = (await board()).households;
    const matching = households.find((h) => h.email === `findme-${stamp}@example.com`)!;
    const other = households.find((h) => h.email === `other-${stamp}@example.com`)!;

    // the photo: opening find dims the families the word misses
    let html = await go(ws, [{ op: "replace", path: "/filter/households", value: matching.code }]);
    expect(html).toContain('class="filter"');
    expect(html).toContain(`&quot;hushed&quot;:true`);
    expect(html).toContain(`>1 of ${households.length}</span>`);
    // the eye: they step out of the photo
    html = await go(ws, [{ op: "replace", path: "/hide/households", value: true }]);
    expect(html).not.toContain(`&quot;hushed&quot;:true`);

    // the list: the same word hides the rows it misses; a household's waiting ask rides on its row as a note
    await asHousehold(matching.code, [{ op: "add", path: "/asks/-", value: "Someone Matching" }]);
    await asHousehold(other.code, [{ op: "add", path: "/asks/-", value: "Someone Else" }]);
    html = await at(ws, "list");
    expect(html).toMatch(new RegExp(`class="row tap hushed" id="household-${other.id}"[^>]* hidden>`));
    expect(html).toContain(`class="row tap" id="household-${matching.id}"`);
    expect(html).toMatch(/\d+ asks? waiting/);
    // the rows run by their answer, said once at the head of each run and not on a row: each run a group named by its head, so a
    // screen reader hears the answer entering it; a run the word misses whole goes with it
    expect(html).toContain('<div class="run" role="group" aria-labelledby="run-none"><h3 class="cap run-head" id="run-none"><span class="answer-word none">');
    expect(html).toContain('<div class="run" role="group" aria-labelledby="run-yes" hidden><h3 class="cap run-head hushed" id="run-yes"><span class="answer-word yes">'); // the Okafors', and anyone else who said yes
    expect(html).not.toContain('class="state"');

    // closing find forgets the word and the eye
    html = await go(ws, [{ op: "remove", path: "/filter/households" }]);
    expect(html).not.toContain('class="filter"');
    expect(html).not.toContain(" hidden>");
    ws.close();
  });

  test("a family's drawer: whether each guest is coming and what they chose, and whoever they asked for -- waiting, with the couple's yes or no, or refused; their figures ring in the photo", async () => {
    const ws = await enter("NICK");
    // under the family's code, a surname they share is said once in each list
    const okafors = await at(ws, `?family=${(await board()).households.find((h) => h.code === "OKAFOR")!.id}`);
    expect(okafors).toContain('<span class="what">Ada</span>');
    expect(okafors).toContain('<span class="what">Femi</span>');
    expect(okafors).toContain('<span class="what">Kemi</span>'); // asked for
    // the lists they keep: an event names where only where it moves, and a repeat says so (the seed's three are all at the Mount Without)
    const events = await at(ws, "?events");
    expect(events.split('<span class="note">The Mount Without</span>').length - 1).toBe(1);
    expect(events.split('<span class="note">same place</span>').length - 1).toBe(2);
    const guest = (await household(code)).guests[0]!.id;
    await asHousehold(code, [{ op: "replace", path: `/guests/${guest}/coming`, value: 1 }, { op: "add", path: "/asks/-", value: "Answered" }, { op: "add", path: "/asks/-", value: "Waiting" }]);
    const ask = (await household(code)).asks.find((a) => a.name === "Answered")!;
    await asCouple([{ op: "replace", path: `/households/${hid}/asks/${ask.id}/reply`, value: "no" }]);
    const drawer = await at(ws, `?family=${hid}`);
    expect(drawer).toContain(">coming</span>");
    expect(drawer).toContain(">not said</span>");
    expect(drawer).toContain(">Asked for</h3>");
    expect(drawer).toContain('<span class="what">Answered</span></span><span class="answer-word no">');
    expect(drawer).toContain('<span class="what">Waiting</span></span><div class="pick" role="radiogroup" aria-label="Waiting, asked for">'); // the couple's yes or no, one choice
    expect(drawer).toContain("&quot;chosen&quot;:true");
    await asHousehold(code, [{ op: "remove", path: `/guests/${guest}/coming` }]);
    ws.close();
  });

  test("beyond sixteen in the photo, everyone sees the families, one figure each with its count, and a family opens", async () => {
    const couple = await enter("NICK");
    const email = `crowd-${Date.now()}@example.com`;
    const names = Array.from({ length: 17 }, (_, i) => `Guest${i}`).join(",");
    await send(couple, "board", [{ op: "add", path: "/households/-", value: { email, names } }]);
    const big = (await board()).households.find((h) => h.email === email)!;
    await asHousehold(big.code, [{ op: "replace", path: "/answer", value: "yes" }]);
    const ws = await enter(big.code);
    const families = await at(ws, "everyone");
    expect(families).toContain("Tap a family to see them");
    // the photo watches everyone, and draws what `crowd` derives from its props: a figure a screen
    // reader can name, and nameless to the eye until the day, whose tap the mount says
    const props = JSON.parse(decoded(/id="everyone-photo" data-applet="crowd" data-doc="everyone:1" data-under="\/everyone" data-v="\d+" data-props="([^"]*)"/.exec(families)![1]!));
    expect(crowd(props).photo.entries.find((e) => e.key === String(big.id))).toMatchObject({ count: 17, name: "a family of 17" });
    expect(families).toContain(`everyone/${big.id}`);
    const family = await at(ws, `everyone/${big.id}`);
    expect(family).toContain('<span class="cell-name">One family</span>');
    expect(family).toContain("17 of them.");
    ws.close();
    // the couple's photo, at the families level too: the crowd one figure, ringing while its drawer is open
    const theirs = await at(couple, `?family=${big.id}`);
    expect(theirs).toMatch(new RegExp(`&quot;count&quot;:17,&quot;tap&quot;:[^}]*}},&quot;hushed&quot;:false,&quot;chosen&quot;:true`));
    expect(theirs).toContain(`&quot;name&quot;:&quot;${big.code}, a family of 17&quot;`);
    await heard(couple);
    await send(couple, "ledger", [{ op: "remove", path: "/latest" }]); // the crowd goes home
    couple.close();
  });

  test("a yes to an ask makes a guest the household sees; the couple's undo takes it back; a household may not reply", async () => {
    const couple = await enter("NICK");
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
    const ws = await enter("NICK");
    const email = `wire-${Date.now()}@example.com`;
    await send(ws, "board", [{ op: "add", path: "/households/-", value: { email, names: "Wire Test", plus_ones: "0" } }]);
    const invited = (await board()).households.find((h) => h.email === email)!;
    expect(invited.guests.map((g) => g.name)).toEqual(["Wire Test"]);
    expect(invited.code).toBe("WIRE-11"); // the email before the @, six letters at most, then the least number no code has
    await refused(ws, "board", [{ op: "add", path: "/households/-", value: { email: "no-at-sign" } }]);
    await send(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect((await board()).households.find((h) => h.email === email)).toBeUndefined();
    ws.close();
  });

  test("a household's tab whose code stops existing is back at the welcome", async () => {
    const couple = await enter("NICK");
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

// Undo beside someone else. The ledger is delta's: a walk sets back only what its entry changed,
// where nobody has changed it since, or walks nothing and says so; and eta looks at a walk before
// it is taken, so the document's own rules (a deadline) hold against Undo too.
describe("undo beside someone else", () => {
  const undo = (ws: WebSocket) => send(ws, "ledger", [{ op: "remove", path: "/latest" }]);

  test("one tab takes back its note, and the note another tab wrote after it stays", async () => {
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

  test("an undo that no longer applies does not stick: the next Undo walks back the write before it", async () => {
    const mine = await enter(code), theirs = await enter(code);
    const answer = (await household(code)).answer;
    await send(mine, "household", [{ op: "replace", path: "/answer", value: answer === "no" ? "yes" : "no" }]);
    await send(mine, "household", [{ op: "add", path: "/claims/-", value: 3 }]);
    await send(theirs, "household", [{ op: "remove", path: "/claims/3" }]); // the claim goes, from the other tab
    const told = await undo(mine); // the claim's undo: nothing left to take back, and Undo says so
    expect(told.page).toContain("Someone has changed that since, so it cannot be undone.");
    await undo(mine);
    try {
      expect((await household(code)).answer).toBe(answer);
    } finally {
      await asHousehold(code, [answer === null ? { op: "remove", path: "/answer" } : { op: "replace", path: "/answer", value: answer }]);
      mine.close();
      theirs.close();
    }
  });

  test("after the deadline an answer is locked, to Undo too: the household's answer, a guest's coming, their choices", async () => {
    const ws = await enter(code);
    const before = await household(code);
    const guest = before.guests[0]!;
    const course = (await board()).courses.find((c) => c.dishes.length > 1)!;
    const chosen = guest.choices[String(course.id)]?.dish ?? null;
    const dish = course.dishes.find((d) => d.id !== chosen)!;
    const closed = async (fn: () => Promise<unknown>) => {
      await asCouple([{ op: "replace", path: "/deadline", value: "2020-01-01" }]);
      await heard(ws); // the household's page shows the deadline
      try {
        await fn();
      } finally {
        await asCouple([{ op: "remove", path: "/deadline" }]);
        await heard(ws);
      }
    };
    const lockedUndo = async () => expect((await undo(ws)).page).toContain("Answers closed at the deadline.");
    try {
      await send(ws, "household", [{ op: "replace", path: "/answer", value: before.answer === "maybe" ? "yes" : "maybe" }]);
      const answered = (await household(code)).answer;
      await closed(async () => {
        await refused(ws, "household", [{ op: "replace", path: "/answer", value: "no" }]);
        await lockedUndo();
        expect((await household(code)).answer).toBe(answered);
      });
      await send(ws, "household", [{ op: "replace", path: `/guests/${guest.id}/coming`, value: guest.coming === 1 ? "no" : "yes" }]);
      const coming = (await household(code)).guests[0]!.coming;
      await closed(async () => {
        await lockedUndo();
        expect((await household(code)).guests[0]!.coming).toBe(coming);
      });
      await send(ws, "household", [{ op: "replace", path: `/guests/${guest.id}/choices/${course.id}/dish`, value: dish.id }]);
      await closed(async () => {
        await lockedUndo();
        expect((await household(code)).guests[0]!.choices[String(course.id)]?.dish).toBe(dish.id);
      });
    } finally {
      await asHousehold(code, [
        before.answer === null ? { op: "remove", path: "/answer" } : { op: "replace", path: "/answer", value: before.answer },
        guest.coming === null ? { op: "remove", path: `/guests/${guest.id}/coming` } : { op: "replace", path: `/guests/${guest.id}/coming`, value: guest.coming },
        chosen === null ? { op: "remove", path: `/guests/${guest.id}/choices/${course.id}/dish` } : { op: "replace", path: `/guests/${guest.id}/choices/${course.id}/dish`, value: chosen },
      ]);
      ws.close();
    }
  });
});

describe("the couple keep a family's invitation", () => {
  test("taking a guest off asks first, and goes back to the family's drawer; the email is edited in place", async () => {
    const ws = await enter("NICK");
    const email = `takeoff-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Tak Test, Tik Test" } }]);
    const h = (await board()).households.find((x) => x.email === email)!;
    const guest = h.guests[0]!;
    const drawer = await at(ws, `?family=${h.id}`);
    expect(drawer).toContain(`aria-label="Take ${guest.name} off"`);
    expect(drawer).toContain(`data-write='{"doc":"board","op":"replace","path":"/households/${h.id}/email"}'`);
    const asked = await at(ws, `?confirm=households/${h.id}/guests/${guest.id}`);
    expect(asked).toContain(`<h3>${guest.name}</h3><p class="note">Take them off the ${h.code} invitation?</p>`);
    expect(asked).toContain(`data-write='{"doc":"board","op":"remove","path":"/households/${h.id}/guests/${guest.id}"}'`);
    const after = (await send(ws, "board", [{ op: "remove", path: `/households/${h.id}/guests/${guest.id}` }])).page;
    expect(after).toContain(`data-page="?family=${h.id}"`);
    expect(after).not.toContain(`aria-label="Take ${guest.name} off"`);
    ws.close();
  });
});

// Each compartment permits what its pages offer, to whom they offer it, and nothing more (`bun
// run model:check wedding`): a field is emptied by replacing it with nothing, never removed; a row's
// parent and a dish's or a drink's order are the server's; a reply is changed, never taken back.
// What the wedding's stories no longer tell one by one is here, each write put to its permit.
describe("a permit allows what a page offers, and nothing more", () => {
  type W = [PatchOp["op"], string];
  /** A session that has entered `who`'s code, and what a compartment permits it. */
  async function as(who: string) {
    const sessionId = crypto.randomUUID();
    const ws = await enter(who, `session_id=${sessionId}`);
    const may = (docType: string, [op, path]: W) => {
      const c = example.compartments.find((x) => x.docType === docType) as Compartment;
      return c.permit!({ data: { sessionId } } as never, op === "remove" ? { op, path } : { op, path, value: "x" }, "1");
    };
    return { ws, may };
  }
  const each = (op: PatchOp["op"], ...paths: string[]): W[] => paths.map((path) => [op, path]);

  // the couple's page: the welcome, an invitation, the four lists, and each row's drawer
  const COUPLE: W[] = [
    ...each("replace", "/name1", "/name2", "/day", "/deadline", "/venue", "/message", "/picture_key"),
    ...each("add", "/households/-", "/households/1/guests/-", "/courses/-", "/gifts/-", "/events/-", "/places/-", "/courses/1/dishes/-", "/courses/1/drinks/-"),
    ...each("replace", "/households/1/email", "/households/1/plus_ones", "/households/1/asks/1/reply"),
    ...each("remove", "/households/1/guests/1", "/courses/1", "/gifts/1", "/events/1", "/places/1", "/courses/1/dishes/1", "/courses/1/drinks/1"),
    ...each("replace", "/courses/1/name", "/courses/1/seq", "/courses/1/dishes/1/name", "/courses/1/dishes/1/dietary", "/courses/1/drinks/1/name"),
    ...each("replace", "/gifts/1/name", "/gifts/1/description", "/gifts/1/link", "/gifts/1/picture_key", "/gifts/1/shared", "/gifts/1/seq"),
    ...each("replace", "/events/1/name", "/events/1/when_at", "/events/1/where_at", "/events/1/notes", "/events/1/seq"),
    ...each("replace", "/places/1/name", "/places/1/notes", "/places/1/link", "/places/1/picture_key", "/places/1/seq"),
    ...each("add", "/venues/-"),
    ...each("remove", "/venues/1"),
    ...each("replace", "/venues/1/name", "/venues/1/notes", "/venues/1/picture_key"),
  ];
  // a household's page: its answer and note, each guest's coming, look and choices, an ask, a claim
  const HOUSEHOLD: W[] = [
    ...each("replace", "/answer", "/message", "/guests/1/coming", "/guests/1/choices/2/dish", "/guests/1/choices/2/drink"),
    ...each("remove", "/answer", "/guests/1/coming", "/guests/1/choices/2/dish", "/guests/1/choices/2/drink", "/claims/1"), // each taken back
    ...each("replace", ...["skin", "hair", "hair_color", "top", "legs", "face", "attitude"].map((f) => `/guests/1/minifigure/${f}`)),
    ...each("add", "/asks/-", "/claims/-"),
  ];

  test("the couple may write what their page offers, and a household none of it", async () => {
    const couple = await as("NICK");
    const ben = await as(code);
    for (const w of COUPLE) expect([w, couple.may("board", w)]).toEqual([w, true]);
    for (const w of COUPLE) expect([w, ben.may("board", w)]).toEqual([w, false]);
    couple.ws.close();
    ben.ws.close();
  });

  test("a household may write what its page offers, and the couple none of it", async () => {
    const household = await as(code);
    const couple = await as("NICK");
    for (const w of HOUSEHOLD) expect([w, household.may("household", w)]).toEqual([w, true]);
    for (const w of HOUSEHOLD) expect([w, couple.may("household", w)]).toEqual([w, false]);
    household.ws.close();
    couple.ws.close();
  });

  test("nobody may remove a field, a row's parent or a dish's order, take back a reply, or uninvite their own guest", async () => {
    const couple = await as("NICK");
    const household = await as(code);
    const fields = COUPLE.filter(([op, path]) => op === "replace" && !path.endsWith("/seq")).map(([, path]): W => ["remove", path]);
    for (const w of [...fields, ...each("replace", "/courses/1/weddings_id", "/gifts/1/weddings_id", "/events/1/weddings_id", "/places/1/weddings_id", "/venues/1/weddings_id", "/courses/1/dishes/1/courses_id", "/courses/1/dishes/1/seq", "/courses/1/drinks/1/seq", "/gifts/1/nope")]) {
      expect([w, couple.may("board", w)]).toEqual([w, false]);
    }
    expect(couple.may("board", ["remove", "/gifts/1/seq"])).toBe(false);
    for (const w of [...each("remove", "/message", "/guests/1"), ...each("add", "/answer")]) expect([w, household.may("household", w)]).toEqual([w, false]);
    couple.ws.close();
    household.ws.close();
  });

  test("what the document refuses, the wire refuses: a drink not chosen cannot be unchosen, nor another household's claim given back", async () => {
    const email = `other-${Date.now()}@example.com`;
    await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Oda Other" } }]);
    const other = (await board()).households.find((x) => x.email === email)!.code;
    await asHousehold(other, [{ op: "add", path: "/claims/-", value: 2 }]);
    const ws = await enter(code);
    const guest = (await household(code)).guests[0]!;
    expect(guest.choices["2"]?.drink ?? null).toBeNull();
    await refused(ws, "household", [{ op: "remove", path: `/guests/${guest.id}/choices/2/drink` }]);
    await refused(ws, "household", [{ op: "remove", path: "/claims/2" }]);
    expect((await household(other)).claims).toContain(2);
    await asHousehold(other, [{ op: "remove", path: "/claims/2" }]);
    ws.close();
  });

  test("a visit's own: a page gone to, and a collection's reading, find's word and its eye by the collection's name", async () => {
    const { ws, may } = await as(code);
    expect(may("session", ["replace", "/page"])).toBe(true);
    expect(may("session", ["remove", "/page"])).toBe(false);
    expect(may("session", ["replace", "/reading/guests"])).toBe(true);
    expect(may("session", ["remove", "/reading/guests"])).toBe(false);
    for (const w of each("replace", "/filter/guests", "/hide/guests").flatMap(([, p]): W[] => [["replace", p], ["remove", p]])) expect([w, may("session", w)]).toEqual([w, true]);
    for (const w of each("replace", "/reading", "/filter", "/hide").flatMap(([, p]): W[] => [["replace", p], ["remove", p]])) expect([w, may("session", w)]).toEqual([w, false]);
    expect(may("session", ["replace", "/resend"])).toBe(true);
    expect(may("session", ["remove", "/resend"])).toBe(false);
    expect(may("session", ["remove", "/code"])).toBe(true);
    ws.close();
  });

  test("a visit's moves are its own: going somewhere and finding someone tell no other tab, the household's own or anyone's", async () => {
    const mine = await enter(code);
    const theirs = await enter(code);
    const couple = await enter("NICK");
    await go(mine, [{ op: "replace", path: "/page", value: "?gifts" }]);
    await go(mine, [{ op: "replace", path: "/filter/guests", value: "Tess" }]);
    for (const ws of [theirs, couple]) expect(await heard(ws)).toMatchObject({ patches: [], renders: [] });
    for (const ws of [mine, theirs, couple]) ws.close();
  });
});
