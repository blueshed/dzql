import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { address, bento, choice, layers, matches, parseAddress, patchCollections, prop, rows, type Collections } from "./bento";
import { esc, join, write } from "./html";
import { diff, drawParts, part } from "./parts";
import { waitFor } from "./webview";
import fixture from "./bento.test.html";

// an example's icons, as the bento sees them: a name and a size in, markup out
const icon = (name: string, size = 16): string => `<i data-icon="${name}" data-size="${size}"></i>`;
const b = bento({ icon, session: "desk", leave: { text: "Leave", icon: "door", path: "/code" } });
const open = write("desk", "replace", "/open", "board");

describe("html", () => {
  test("esc escapes the five, and says nothing for nothing", () => {
    expect(esc(`<a href="x">Tom & 'Jo'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jo&#39;&lt;/a&gt;");
    expect(esc(undefined)).toBe("");
  });

  test("write names a document, an op and a path, and carries a value only when there is one", () => {
    expect(write("desk", "remove", "/open")).toBe(` data-write='{"doc":"desk","op":"remove","path":"/open"}'`);
    expect(open).toBe(` data-write='{"doc":"desk","op":"replace","path":"/open"}' data-value="board"`);
  });

  test("a path built from what someone typed cannot end write's attribute", () => {
    const typed = write("session", "replace", "/rooms/lobby' onclick='alert(1)/topic & more");
    const seen: Record<string, string> = {};
    new HTMLRewriter()
      .on("button", { element: (el) => void Object.assign(seen, Object.fromEntries(el.attributes)) })
      .transform(`<button${typed}>Set</button>`);
    expect(Object.keys(seen)).toEqual(["data-write"]);
    const decoded = seen["data-write"]!.replaceAll("&#39;", "'").replaceAll("&amp;", "&"); // as a browser reads the attribute
    expect(JSON.parse(decoded)).toEqual({ doc: "session", op: "replace", path: "/rooms/lobby' onclick='alert(1)/topic & more" });
  });

  test("join drops what is not a string", () => {
    expect(join("a", false, null, undefined, "b")).toBe("ab");
  });
});

describe("the surfaces", () => {
  test("the trail: the last crumb is where you are, an earlier one with a write is a way back, the root without one is only named", () => {
    const out = b.crumbs([{ label: "Root" }, { label: "Box", back: open }, { label: "Here & now" }]);
    expect(out).toContain('<span class="root">Root</span>');
    expect(out).toContain(`<a href="#"${open}>Box</a>`);
    expect(out).toContain('<b aria-current="page">Here &amp; now</b>');
    expect(out.match(/class="sep"/g)).toHaveLength(2);
  });

  test("a tool is a button with a word; in a stack, a square one that says its word to a screen reader", () => {
    expect(b.tool("Save", { write: open })).toBe(`<button type="button" class="tool"${open}>Save</button>`);
    const square = b.tool("Find", { icon: "search", iconOnly: true, pressed: true, kind: "quiet", disabled: true, write: "" });
    expect(square).toContain('class="tool quiet" aria-label="Find" aria-pressed="true" disabled>');
    expect(square).toContain('<span class="sr-only">Find</span>');
    expect(b.tool("Go", { submit: true, label: "Go now", write: "" })).toContain('type="submit" class="tool" aria-label="Go now"');
  });

  test("the page's tools are undo, redo and leaving; without a leave there are only the two", () => {
    const out = b.pageTools("across");
    expect(out).toContain('class="stack page-tools across"');
    expect(out).toContain(`{"doc":"ledger","op":"remove","path":"/latest"}`);
    expect(out).toContain(`{"doc":"ledger","op":"add","path":"/latest"}`);
    expect(out).toContain(`class="tool quiet" aria-label="Leave" data-write='{"doc":"desk","op":"remove","path":"/code"}'><i data-icon="door"`);
    const plain = bento({ icon, session: "desk" }).pageTools();
    expect(plain).toContain('class="stack page-tools"');
    expect(plain).not.toContain("quiet");
  });

  test("the reading switch writes the session's /reading/<key>, the current one pressed; the plus writes /new", () => {
    const out = b.readingSwitch("board", "list", [["spark", "chart"], ["list", "list"]]);
    expect(out).toContain(`aria-checked="false" aria-pressed="false" aria-label="spark" data-write='{"doc":"desk","op":"replace","path":"/reading/board"}' data-value="spark"><i data-icon="chart"`);
    expect(out).toContain('aria-checked="true" aria-pressed="true" aria-label="list"');
    expect(b.addTool(open, "Watch")).toContain(`aria-label="Watch"${open}>`);
  });

  test("find: closed, a tool that opens it; open, the field, the tally and the eye, each a write to the session", () => {
    const closed = b.findControl("market", { shown: 3, total: 3 });
    expect(closed.filter).toBeUndefined();
    expect(closed.tool).toContain(`aria-pressed="false" data-write='{"doc":"desk","op":"replace","path":"/filter/market"}' data-value=""`);
    const dim = b.findControl("market", { word: "al", shown: 1, total: 3 });
    expect(dim.tool).toContain(`aria-pressed="true" data-write='{"doc":"desk","op":"remove","path":"/filter/market"}'`);
    expect(dim.filter).toContain('<form data-write-on="input"><input name="q" type="search" value="al"');
    expect(dim.filter).toContain('<span class="tally">1 of 3</span>');
    expect(dim.filter).toContain(`aria-label="Hide what misses" aria-pressed="false" data-write='{"doc":"desk","op":"replace","path":"/hide/market"}' data-value="true"><i data-icon="eye"`);
    const hid = b.findControl("market", { word: "al", hide: true, shown: 1, total: 3 });
    expect(hid.filter).toContain(`aria-label="Show what misses" aria-pressed="true" data-write='{"doc":"desk","op":"remove","path":"/hide/market"}'><i data-icon="eye-off"`);
  });

  test("a cell: › and data-moving when it opens, ✎ and pressed when it is a thing, neither when it is only read; its name is its button when it opens", () => {
    const opens = b.cell({ name: "The board", mark: "chart", count: 2, big: true, opens: open, summary: "live", body: "<svg/>" });
    expect(opens).toMatchObject({ key: "the-board", span: 3, rows: 1 });
    expect(opens.html).toContain(`<div class="cell big" data-key="the-board" data-moving="the-board"${open}>`);
    expect(opens.html).toContain('<button type="button" class="cell-name">The board · 2</button><span class="chev"><i data-icon="chevron-right"');
    expect(opens.html).toContain('<p class="cell-summary">live</p><div class="cell-body"><svg/></div>');
    const thing = b.cell({ name: "clock", key: "c", span: 2, thing: { open, chosen: true } });
    expect(thing).toMatchObject({ key: "c", span: 2 });
    expect(thing.html).toContain(`<div class="cell thing" data-key="c"${open}><div class="cell-head cap"><button type="button" class="cell-name" aria-pressed="true">clock</button>`);
    expect(thing.html).toContain('<span class="chev pencil">');
    const read = b.cell({ name: "quiet" });
    expect(read.span).toBe(1);
    expect(read.html).toBe('<div class="cell" data-key="quiet"><div class="cell-head cap"><span class="cell-name">quiet</span></div></div>');
  });

  test("a box: the trail and the page's tools above, what is in place, each cell in its area with its corners", () => {
    const cells = [b.cell({ name: "board", big: true, opens: open }), b.cell({ name: "market" }), b.cell({ name: "clock" })];
    const out = b.boxPage([{ label: "The desk" }], ["<p>in place</p>"], cells);
    expect(out).toContain('<b aria-current="page">The desk</b></span></nav><div class="stack page-tools across"');
    expect(out).toContain('<section class="page box"><p>in place</p><div class="cells"');
    expect(out).toContain(`--tray-areas: "board board board" "market clock clock"; --tray-areas-phone: "board" "market" "clock"`);
    expect(out).toContain('data-key="board" data-corners="tl tr" data-corners-phone="tl tr" style="grid-area: board"');
    expect(out).toContain('data-key="clock" data-corners="br" data-corners-phone="br bl" style="grid-area: clock"');
  });

  test("a box with one open: that cell is the window -- the way back and its name, its rail, the reading, a note, the page's tools, and find's field last", () => {
    const cells = [b.cell({ name: "board", opens: open }), b.cell({ name: "market", opens: open })];
    const back = write("desk", "remove", "/open");
    const out = b.boxPage([{ label: "The desk", back }, { label: "the market" }], [], cells, { key: "market", reading: "<i>reading</i>", tools: ["<i>find</i>"], filter: "<i>filter</i>", body: "<i>rows</i>", note: "a note" });
    expect(out).toContain('<section class="page box windowed">');
    expect(out).not.toContain("page-tools across"); // the page's tools are in the window instead
    expect(out).toContain(`<div data-eta-part="market" class="cell open" data-key="market" data-moving="market"><div class="cell-head cap"><a class="cell-back" href="#"${back}>The desk</a>`);
    expect(out).toContain('<span class="cell-name">the market</span></div><div class="rail work"><i>reading</i><div class="stack"><i>find</i></div></div><div class="full"><i>rows</i><p class="note">a note</p></div><div class="stack page-tools"');
    // last, so find opening and closing moves nothing the morph matches by position
    expect(out).toMatch(/<div class="stack page-tools"[^]*<\/div><i>filter<\/i><\/div>/);
    expect(out).toContain('data-key="board" data-corners='); // the rest of the box holds still behind it
    // and is not to be reached or heard while the window is open: its trail, the other cells, what is in place
    expect(out).toContain('<header class="page-head" inert>');
    expect(out).toMatch(/<div data-eta-part="board" class="cell" data-key="board"[^>]* inert[ >]/);
    expect(out).not.toMatch(/class="cell open"[^>]* inert/);
    expect(b.boxPage([{ label: "The desk" }], ["<p>in place</p>"], cells, { key: "market", body: "" })).toContain('<div class="in-place" inert><p>in place</p></div>');
    expect(b.boxPage([{ label: "The desk" }], ["<p>in place</p>"], cells)).not.toContain("inert"); // closed, all of it is there
    // a window on the root has no way back, and may have no tools at all
    const bare = b.boxPage([{ label: "rooms" }], [], cells, { key: "board", body: "" });
    expect(bare).toContain('<div class="cell-head cap"><span class="cell-name">rooms</span></div><div class="rail work"></div><div class="full"></div>');
  });

  test("the window's head is the whole trail, as the page's is: every earlier crumb a way back, the root included", () => {
    const cells = [b.cell({ name: "conversation", opens: open })];
    const leave = write("desk", "remove", "/room");
    const close = write("desk", "remove", "/open");
    const trail = [{ label: "Eta" }, { label: "Chat", back: leave }, { label: "#general", back: close }, { label: "conversation" }];
    const head = b.boxPage(trail, [], cells, { key: "conversation", body: "" }).match(/<div class="cell-head cap">.*?<\/div>/)![0];
    expect(head).toContain('<span class="cell-root">Eta</span>'); // named, but not a place
    expect(head).toContain(`<a class="cell-back" href="#"${leave}>Chat</a>`);
    expect(head).toContain(`<a class="cell-back" href="#"${close}>#general</a>`);
    expect(head).toContain('<span class="cell-name">conversation</span>');
    expect(head.match(/class="chev"/g)).toHaveLength(3);
  });

  test("a page that is a collection is the window alone: the trail, the rail, the reading, the page's tools, and no tray behind it", () => {
    const out = b.collectionPage([{ label: "Chat" }], { key: "rooms", tools: ["<i>plus</i>"], body: "<i>rows</i>" });
    expect(out).toStartWith('<section class="page windowed"><div data-eta-part="rooms" class="cell open" data-key="rooms" data-moving="rooms"><div class="cell-head cap"><span class="cell-name">Chat</span></div>');
    expect(out).toContain('<div class="stack"><i>plus</i></div></div><div class="full"><i>rows</i></div><div class="stack page-tools"');
    expect(out).not.toContain('class="cells"');
  });

  test("a row: a lead, the words, the state, the mark; tapped (a button, the whole line), chosen, hushed or hidden as it is told", () => {
    const out = b.row({ id: "r-1", tap: open, chosen: true, hushed: true, hidden: true, lead: "<img>", what: "Ada & co", note: "two", state: "<b>here</b>", mark: "pencil" });
    expect(out).toStartWith(`<button data-eta-part="r-1" type="button" class="row tap hushed" id="r-1"${open} aria-pressed="true" data-reveal hidden>`);
    expect(out).toEndWith("</button>");
    expect(out).toContain('<span class="lead"><img></span><span class="words"><span class="what">Ada &amp; co</span><span class="note">two</span></span><span class="state"><b>here</b></span><span class="mark"><i data-icon="pencil"');
    expect(b.row({ what: "plain", mark: "chevron" })).toBe('<div class="row"><span class="words"><span class="what">plain</span></span><span class="mark"><i data-icon="chevron-right" data-size="18"></i></span></div>');
    expect(b.row({ what: "read only" })).not.toContain("mark");
    expect(rows([], "None yet.")).toBe('<p class="note">None yet.</p>');
    expect(rows(["<a/>", "<b/>"], "None yet.")).toBe('<div class="rows"><a/><b/></div>');
  });

  test("the drawer and its properties; a choice among a few", () => {
    const close = write("desk", "remove", "/focus");
    const out = b.drawer("drawer", "ALPH", prop("Name", "<span>Alpha</span>"), close, "wide");
    expect(out).toContain(`<div class="scrim"${close}></div><div data-eta-part="drawer" id="drawer" class="drawer wide" role="dialog" aria-label="ALPH">`);
    expect(out).toContain(`<button type="button" class="tool quiet drawer-close" aria-label="Close" data-escape${close}>`); // what Escape presses
    expect(out).toContain('<div class="prop"><span class="prop-name cap">Name</span><div class="prop-value"><span>Alpha</span></div></div>');
    expect(b.drawer("d", "t", "", close)).toContain('class="drawer" role');
    const pick = choice("Coming?", [{ text: "Yes", on: true, write: open, kind: "yes" }, { text: "No", on: false, write: open }], true);
    expect(pick).toContain(`<button type="button" class="tool yes" role="radio" aria-checked="true" aria-pressed="true"${open} disabled>Yes</button>`);
    expect(choice("x", [{ text: "No", on: false, write: open }])).toContain(`class="tool" role="radio" aria-checked="false" aria-pressed="false"${open}>No`);
  });

  test("the modals: adding asks for the fields it needs, removing asks one question; cancelling writes the session", () => {
    const close = write("desk", "replace", "/page", "rooms");
    const add = b.addModal("A new room", [{ name: "room", label: "Its name" }, { name: "seats", label: "Seats", type: "number", required: false, value: "4", placeholder: "how many" }], open, close);
    expect(add).toContain(`<div class="scrim modal-scrim" data-escape${close}></div><dialog open class="modal" aria-label="A new room"><h3>A new room</h3><form${open}>`);
    expect(add).toContain('<input name="room" type="text" value="" placeholder="" autocomplete="off" required autofocus>');
    expect(add).toContain('<input name="seats" type="number" min="0" value="4" placeholder="how many" autocomplete="off">');
    expect(add).toContain('type="submit" class="tool add"><i data-icon="plus" data-size="16"></i>Add</button>');
    expect(b.addModal("t", [], open, close, "Make it")).toContain("Make it</button>");
    const drop = b.confirmModal("Stop watching ALPH", "Its row leaves.", open, close, "Stop watching");
    expect(drop).toContain(`<div class="scrim modal-scrim" data-escape${close}></div>`);
    expect(drop).toContain(`<p class="note">Its row leaves.</p>`);
    expect(drop).toContain(`class="tool danger"${open}><i data-icon="trash" data-size="16"></i>Stop watching</button>`);
    expect(b.confirmModal("t", "q", open, close)).toContain("Remove</button>");
    // the layers are always there, empty when nothing is open; a modal puts the ground inert
    expect(layers("<p/>", "", "")).toBe(`<div data-eta-part="ground" class="ground"><p/><div data-eta-part="drawers" class="layer"></div></div><div data-eta-part="modals" class="layer"></div>`);
    expect(layers("<p/>", "<aside/>", "<dialog/>")).toBe(`<div data-eta-part="ground" class="ground" inert><p/><div data-eta-part="drawers" class="layer"><aside/></div></div><div data-eta-part="modals" class="layer"><dialog/></div>`);
  });

  test("a modal's field may be chosen, not typed: given options it is a select, its value the option drawn chosen; or it is a link", () => {
    const close = write("desk", "replace", "/page", "kyoto");
    const kinds = [{ value: "see", text: "See" }, { value: "eat", text: "Eat & drink" }];
    const add = b.addModal("A stop in Kyoto", [{ name: "kind", label: "Its kind", options: kinds, value: "eat" }, { name: "url", label: "A link", type: "url", required: false }], open, close);
    expect(add).toContain('<label class="modal-field"><span class="note">Its kind</span><select name="kind" required autofocus><option value="see">See</option><option value="eat" selected>Eat &amp; drink</option></select></label>');
    expect(add).toContain('<input name="url" type="url" value="" placeholder="" autocomplete="off">');
    expect(b.addModal("t", [{ name: "kind", label: "k", options: kinds, required: false }], open, close)).toContain('<select name="kind" autofocus><option value="see">See</option><option value="eat">'); // none given: the first is what it shows
  });
});

describe("a page's address", () => {
  test("where you are, and the one thing open over it, as one string and back", () => {
    expect(address("guests")).toBe("guests");
    expect(address("guests", "guest", 2)).toBe("guests?guest=2");
    expect(address("", "answer")).toBe("?answer");
    expect(address("courses", "keep", "courses/2")).toBe("courses?keep=courses/2");
    expect(parseAddress("guests?guest=2")).toEqual({ path: "guests", what: "guest", which: "2" });
    expect(parseAddress("?answer")).toEqual({ path: "", what: "answer", which: "" });
    expect(parseAddress("households/3/asks")).toEqual({ path: "households/3/asks" });
    expect(parseAddress()).toEqual({ path: "" });
  });
});

describe("find's word", () => {
  test("no word, or a blank one, hits everything; otherwise a plain substring, whatever the case", () => {
    expect(matches("Alpha", undefined)).toBe(true);
    expect(matches("Alpha", "  ")).toBe(true);
    expect(matches("Alpha Systems", " SYS ")).toBe(true);
    expect(matches("Alpha", "beta")).toBe(false);
  });
});

describe("patchCollections", () => {
  const replace = (path: string, value?: unknown) => ({ op: "replace" as const, path, value });
  const remove = (path: string) => ({ op: "remove" as const, path });

  test("sets a reading, find's word (even blank) and the eye, each by the collection's name", () => {
    const ui: Collections = {};
    expect(patchCollections(ui, replace("/reading/board", "list"))).toBe(true);
    expect(patchCollections(ui, replace("/filter/market"))).toBe(true);
    expect(patchCollections(ui, replace("/filter/rooms", "ge"))).toBe(true);
    expect(patchCollections(ui, replace("/hide/market", "anything"))).toBe(true);
    expect(ui).toEqual({ reading: { board: "list" }, filter: { market: "", rooms: "ge" }, hide: { market: true } });
  });

  test("closing find removes its own key and forgets the eye with it; the last key takes the map too", () => {
    const ui: Collections = { reading: { board: "list" }, filter: { market: "al", rooms: "ge" }, hide: { market: true } };
    expect(patchCollections(ui, remove("/filter/market"))).toBe(true);
    expect(ui).toEqual({ reading: { board: "list" }, filter: { rooms: "ge" } });
    expect(patchCollections(ui, remove("/filter/rooms"))).toBe(true);
    expect(patchCollections(ui, remove("/reading/board"))).toBe(true);
    expect(ui).toEqual({});
  });

  test("the eye alone comes off and leaves the word", () => {
    const ui: Collections = { filter: { market: "al" }, hide: { market: true, rooms: true } };
    expect(patchCollections(ui, remove("/hide/market"))).toBe(true);
    expect(ui).toEqual({ filter: { market: "al" }, hide: { rooms: true } });
  });

  test("anything else is not its business: another field, no key, a remove that finds nothing", () => {
    const ui: Collections = { filter: { market: "al" } };
    expect(patchCollections(ui, replace("/open", "board"))).toBe(false);
    expect(patchCollections(ui, remove("/reading"))).toBe(false);
    expect(patchCollections(ui, remove("/hide/market"))).toBe(false);
    expect(patchCollections(ui, remove("/filter/rooms"))).toBe(false);
    expect(ui).toEqual({ filter: { market: "al" } });
  });
});

// The surfaces as a person meets them: drawn in a real browser with the kernel's stylesheet and its
// client (src/client/app.ts), the socket stubbed as src/client/app.test.ts stubs it -- what the
// client would send is kept in `window.__sent`, and a render is a message on its own socket.
describe("the surfaces in a browser", () => {
  let server: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: { "/": fixture, "/ws": (req, server) => (server.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 })) },
      websocket: { open() {}, message() {}, close() {} },
    });
  });
  afterAll(() => server.stop(true));

  /** A phone's view of `html`, drawn as a render the server sent. */
  async function show(html: string, width = 375): Promise<Bun.WebView> {
    const view = new Bun.WebView({ width, height: 740 });
    await view.navigate(server.url.toString());
    await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
    await view.evaluate(`(() => { window.__sent = []; window.eta.socket().send = (data) => window.__sent.push(JSON.parse(data)); })()`);
    await draw(view, html);
    return view;
  }

  /** The server drawing the page again. */
  async function draw(view: Bun.WebView, html: string): Promise<void> {
    const payload = JSON.stringify({ type: "render", html });
    await view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(payload)} }))`);
    await waitFor(view, `document.getElementById('app').innerHTML.length > 0`, (v) => v === true);
  }

  const sent = (view: Bun.WebView) => view.evaluate<{ doc: string; ops: { op: string; path: string; value?: unknown }[] }[]>(`window.__sent`);
  const go = (page: string) => write("desk", "replace", "/page", page);

  /** Every control on the page that can take the keyboard, by the words it says. */
  const reachable = (view: Bun.WebView) =>
    view.evaluate<string[]>(`[...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) => { el.focus(); return document.activeElement === el; }).map((el) => el.textContent.trim() || el.getAttribute('aria-label'))`);

  test("behind an open window nothing is reached or heard: the trail, the other cells and what is in place are inert", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "market", opens: go("market") }), b.cell({ name: "clock", thing: { open: go("?clock"), chosen: false } })];
    const trail = [{ label: "The desk", back: go("") }, { label: "the market" }];
    const inPlace = [`<button type="button" class="tool">Say</button>`];
    await using view = await show(b.boxPage(trail, inPlace, cells, { key: "market", tools: [b.tool("Find", { icon: "search", iconOnly: true, write: go("market?find") })], body: rows([b.row({ tap: go("market?symbol=A"), what: "Alpha" })], "none") }));
    // the window's own: its way back, its tool, its row, the page's tools
    expect(await reachable(view)).toEqual(["The desk", "Find", "Alpha", "Undo", "Redo", "Leave"]);
  });

  // the page whole, or in parts as the ticker's goes: the site a part, the layers in it (src/parts.ts works out what changed)
  for (const sent_ of ["whole", "in parts"] as const) {
    test(`the keyboard goes with the cell: opening a window puts it on the way back, closing it puts it back on the cell (the page sent ${sent_})`, async () => {
      const page = (market: boolean) => {
        const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "market", opens: go("market") })];
        const box = market
          ? b.boxPage([{ label: "The desk", back: go("") }, { label: "the market" }], [], cells, { key: "market", body: rows([b.row({ id: "r-a", tap: go("market?symbol=A"), what: "Alpha" })], "none") })
          : b.boxPage([{ label: "The desk" }], [], cells);
        return part("site", `<div class="site">${layers(box, "", "")}</div>`);
      };
      const drawn = [drawParts(() => page(false)), drawParts(() => page(true))] as const;
      const [open, close] = [diff(drawn[0], drawn[1]), diff(drawn[1], drawn[0])];
      if (sent_ === "in parts") expect([open?.length, close?.length]).toEqual([expect.any(Number), expect.any(Number)]); // parts, not the page whole
      const send = (view: Bun.WebView, to: 0 | 1, ops?: unknown[]) =>
        sent_ === "whole" ? draw(view, drawn[to].html) : view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(JSON.stringify({ type: "render", ops }))} }))`);
      const focused = `document.activeElement.closest('.cell')?.dataset.key + ' ' + document.activeElement.textContent.trim()`;

      await using view = await show(drawn[0].html);
      await view.evaluate(`document.querySelector('.cell[data-key="market"] button').focus()`);
      await view.press("Space");
      await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
      await send(view, 1, open);
      await waitFor(view, `document.querySelector('.cell.open') !== null`, (v) => v === true);
      expect(await waitFor(view, focused, (v) => v === "market The desk", 1000).catch(() => view.evaluate(focused))).toBe("market The desk");

      await view.evaluate(`document.activeElement.click()`); // the way back, as Enter on it would
      expect((await sent(view)).at(-1)).toEqual({ doc: "desk", ops: [{ op: "replace", path: "/page", value: "" }] });
      await send(view, 0, close);
      await waitFor(view, `document.querySelector('.cell.open') === null`, (v) => v === true);
      expect(await waitFor(view, focused, (v) => v === "market market", 1000).catch(() => view.evaluate(focused))).toBe("market market");
    });
  }

  test("what opens is a button: each cell, thing and row that opens is where a Tab stops, and Space or Enter opens it", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "clock", thing: { open: go("?clock"), chosen: false } }), b.cell({ name: "quiet" })];
    const list = rows([b.row({ id: "r-a", tap: go("?symbol=A"), what: "Alpha", mark: "pencil" }), b.row({ id: "r-b", what: "Beta" })], "none");
    await using view = await show(b.boxPage([{ label: "The desk" }], [list], cells));
    // where a Tab stops in each: the element itself, or what in it takes the keyboard
    const stop = (selector: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el.matches('button, a[href], [tabindex]') ? el : el.querySelector('button, a[href], [tabindex]'); })()`;
    const opens: [string, string][] = [['.cell[data-key="board"]', "board"], ['.cell[data-key="clock"]', "?clock"], ["#r-a", "?symbol=A"]];
    for (const [selector, page] of opens) {
      await view.evaluate(`(window.__sent = [], ${stop(selector)}.focus())`);
      await view.press("Space");
      await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000).catch(() => {});
      expect({ selector, sent: await sent(view) }).toEqual({ selector, sent: [{ doc: "desk", ops: [{ op: "replace", path: "/page", value: page }] }] });
      expect(await view.evaluate<string>(`${stop(selector)}.tagName`)).toBe("BUTTON"); // so Enter opens it too: the browser's own
      // WebKit's press("Enter") is an editing command, not a key, so it is Chrome that says so
      if (process.platform !== "darwin") {
        await view.press("Enter");
        await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
      }
    }
    // what only reads is not a stop at all
    expect(await view.evaluate<boolean>(`document.querySelector('.cell[data-key="quiet"]').matches(':is(button, [tabindex]), :has(button, [tabindex])')`)).toBe(false);
    expect(await view.evaluate<boolean>(`document.getElementById('r-b').matches(':is(button, [tabindex]), :has(button, [tabindex])')`)).toBe(false);
  });
});
