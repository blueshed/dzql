import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { address, bento, choice, collectionsWrite, field, layers, matches, parseAddress, patchCollections, prop, rows, type Collections, type FieldOptions } from "./bento";
import { appletProps, esc, join, write } from "./html";
import { decoded, diff, drawParts, part } from "./parts";
import { waitFor, webview } from "./webview";
import { renderMessage } from "./resources/render";
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
    expect(open).toBe(` data-write='{"doc":"desk","op":"replace","path":"/open"}' data-value='"board"'`);
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

  test("appletProps quotes an applet's props once, whatever they hold; with a document it watches, names it and where it sits in them", () => {
    const props = { word: `Tom & 'Jo' "<b>"`, doc: { rows: { "1": { name: "Ada" } } } };
    const read = (attrs: string): Record<string, string> => {
      const seen: Record<string, string> = {};
      new HTMLRewriter().on("div", { element: (el) => void Object.assign(seen, Object.fromEntries([...el.attributes].map(([name, value]) => [name, decoded(value)]))) }).transform(`<div${attrs}></div>`);
      return seen; // as a browser reads them
    };
    expect(appletProps({ n: 1 })).toBe(` data-props="{&quot;n&quot;:1}"`);
    const alone = read(appletProps(props));
    expect(Object.keys(alone)).toEqual(["data-props"]);
    expect(JSON.parse(alone["data-props"]!)).toEqual(props);
    const watching = read(appletProps(props, { doc: `trip:"1"`, under: "/doc" }));
    expect(watching).toEqual({ "data-doc": `trip:"1"`, "data-under": "/doc", "data-props": JSON.stringify(props) });
    expect(appletProps({ tz: "UTC" }, { doc: "clock" })).toBe(` data-doc="clock" data-props="{&quot;tz&quot;:&quot;UTC&quot;}"`); // the props are the document
    // the document's version, as the props hold it: the patches at or below it are held already
    expect(appletProps({ tz: "UTC" }, { doc: "clock", v: 7 })).toBe(` data-doc="clock" data-v="7" data-props="{&quot;tz&quot;:&quot;UTC&quot;}"`);
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
    // a toggle is pressed; what opens a drawer is expanded while the drawer is open
    expect(b.tool("Gifts", { icon: "search", iconOnly: true, expanded: true, write: "" })).toContain('class="tool" aria-label="Gifts" aria-expanded="true">');
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

  test("the reading switch writes the session's /reading/<key>, the current one checked (a radio is checked, not pressed); the plus writes /new", () => {
    const out = b.readingSwitch([["spark", "chart", false, b.readAs("board", "spark")], ["list", "list", true, b.readAs("board", "list")]]);
    expect(out).toContain(`role="radio" aria-checked="false" aria-label="spark" data-write='{"doc":"desk","op":"replace","path":"/reading/board"}' data-value='"spark"'><i data-icon="chart"`);
    expect(out).toContain('role="radio" aria-checked="true" aria-label="list"');
    expect(b.addTool(open, "Watch")).toContain(`aria-label="Watch"${open}>`);
  });

  test("find: closed, a tool that opens it; open, the field, the tally and the eye, each a write to the session", () => {
    const closed = b.findControl("market", { shown: 3, total: 3 });
    expect(closed.filter).toBeUndefined();
    expect(closed.tool).toContain(`aria-pressed="false" data-write='{"doc":"desk","op":"replace","path":"/filter/market"}' data-value='""'`);
    const dim = b.findControl("market", { word: "al", shown: 1, total: 3 });
    expect(dim.tool).toContain(`aria-pressed="true" data-write='{"doc":"desk","op":"remove","path":"/filter/market"}'`);
    expect(dim.filter).toContain('<form data-write-on="input"><input name="q" type="search" value="al"');
    expect(dim.filter).toContain('<span class="tally">1 of 3</span>');
    expect(dim.filter).toContain(`aria-label="Hide what misses" aria-pressed="false" data-write='{"doc":"desk","op":"replace","path":"/hide/market"}' data-value='true'><i data-icon="eye"`);
    const hid = b.findControl("market", { word: "al", hide: true, shown: 1, total: 3 });
    expect(hid.filter).toContain(`aria-label="Show what misses" aria-pressed="true" data-write='{"doc":"desk","op":"remove","path":"/hide/market"}'><i data-icon="eye-off"`);
  });

  test("a cell: › and data-moving when it opens, ✎ and expanded while its drawer is open when it is a thing, neither when it is only read; its name is its button when it opens", () => {
    const opens = b.cell({ name: "The board", mark: "chart", count: 2, big: true, opens: open, summary: "live", body: "<svg/>" });
    expect(opens).toMatchObject({ key: "the-board", span: 3, rows: 1 });
    expect(opens.html).toContain(`<div class="cell big" data-key="the-board" data-moving="the-board"${open}>`);
    expect(opens.html).toContain('<button type="button" class="cell-name" aria-expanded="false">The board · 2</button><span class="chev"><i data-icon="chevron-right"'); // it opens the window, and is gone while it is open
    expect(opens.html).toContain('<p class="cell-summary">live</p><div class="cell-body"><svg/></div>');
    const thing = b.cell({ name: "clock", key: "c", span: 2, thing: { open, chosen: true } });
    expect(thing).toMatchObject({ key: "c", span: 2 });
    expect(thing.html).toContain(`<div class="cell thing" data-key="c"${open}><div class="cell-head cap"><button type="button" class="cell-name" aria-expanded="true">clock</button>`);
    expect(thing.html).toContain('<span class="chev pencil">');
    const read = b.cell({ name: "quiet" });
    expect(read.span).toBe(1);
    expect(read.html).toBe('<div class="cell" data-key="quiet"><div class="cell-head cap"><span class="cell-name">quiet</span></div></div>');
  });

  test("a box: the trail and the page's tools above, what is in place, each cell in its area with its corners", () => {
    const cells = [b.cell({ name: "board", big: true, opens: open }), b.cell({ name: "market" }), b.cell({ name: "clock" })];
    const out = b.boxPage([{ label: "The desk" }], ["<p>in place</p>"], cells);
    expect(out).toContain('<b aria-current="page">The desk</b></span></nav><div class="stack page-tools across"');
    expect(out).toContain('<section class="page box"><div class="in-place"><p>in place</p></div><div class="cells"');
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
    expect(out).toContain(`<div data-eta-part="market" class="cell open" data-key="market" data-moving="market" role="region" aria-label="the market"><div class="cell-head cap"><a class="cell-back" href="#"${back}><span>The desk</span></a>`);
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
    expect(b.boxPage([{ label: "The desk" }], [], cells)).toContain('<div class="in-place"></div><div class="cells"'); // the wrapper always, so opening changes only its tag
    // a window always has a way back: a trail with none gains it, back to the box, the cell named last (cafe-c's feedback)
    const bare = b.boxPage([{ label: "rooms" }], [], cells, { key: "board", body: "" });
    expect(bare).toContain(`<div class="cell-head cap"><a class="cell-back" href="#"${b.go("")}><span>rooms</span></a>`);
    expect(bare).toContain('<span class="cell-name">board</span></div><div class="rail work"></div><div class="full"></div>'); // and may have no tools at all
    const windowOf = (html: string) => html.slice(html.indexOf('class="cell open"'));
    expect(windowOf(b.boxPage([{ label: "rooms" }, { label: "board" }], [], cells, { key: "board", body: "" }))).toBe(windowOf(bare)); // its name already in the trail
  });

  test("the window's head is the whole trail, as the page's is: every earlier crumb a way back, the root included", () => {
    const cells = [b.cell({ name: "conversation", opens: open })];
    const leave = write("desk", "remove", "/room");
    const close = write("desk", "remove", "/open");
    const trail = [{ label: "Eta" }, { label: "Chat", back: leave }, { label: "#general", back: close }, { label: "conversation" }];
    const head = b.boxPage(trail, [], cells, { key: "conversation", body: "" }).match(/<div class="cell-head cap">.*?<\/div>/)![0];
    expect(head).toContain('<span class="cell-root">Eta</span>'); // named, but not a place
    expect(head).toContain(`<a class="cell-back" href="#"${leave}><span>Chat</span></a>`);
    expect(head).toContain(`<a class="cell-back" href="#"${close}><span>#general</span></a>`);
    expect(head).toContain('<span class="cell-name">conversation</span>');
    expect(head.match(/class="chev"/g)).toHaveLength(3);
  });

  test("a page that is a collection is the window alone: the trail, the rail, the reading, the page's tools, and no tray behind it", () => {
    const out = b.collectionPage([{ label: "Chat" }], { key: "rooms", tools: ["<i>plus</i>"], body: "<i>rows</i>" });
    expect(out).toStartWith('<section class="page windowed"><div data-eta-part="rooms" class="cell open" data-key="rooms" data-moving="rooms" role="region" aria-label="Chat"><div class="cell-head cap"><span class="cell-name">Chat</span></div>');
    expect(out).toContain('<div class="stack"><i>plus</i></div></div><div class="full"><i>rows</i></div><div class="stack page-tools"');
    expect(out).not.toContain('class="cells"');
  });

  test("a row: a lead, the words, the state, the mark; tapped (a button, the whole line), chosen, hushed or hidden as it is told", () => {
    const out = b.row({ id: "r-1", tap: open, chosen: true, hushed: true, hidden: true, lead: "<img>", what: "Ada & co", note: "two", state: "<b>here</b>", mark: "pencil" });
    expect(out).toStartWith(`<button data-eta-part="r-1" type="button" class="row tap hushed" id="r-1"${open} aria-expanded="true" data-reveal hidden>`); // its drawer is open
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
    expect(pick).toContain(`<button type="button" class="tool yes" role="radio" aria-checked="true"${open} disabled>Yes</button>`); // a radio is checked, not pressed
    expect(choice("x", [{ text: "No", on: false, write: open }])).toContain(`class="tool" role="radio" aria-checked="false"${open}>No`);
  });

  test("a field is one call, and cannot be wired wrong: its own form writing its path on the trigger its kind takes, its label tied to it, a status beside it when given, read where the permit says no", () => {
    const email = field({ doc: "trip", path: "/people/2/email", value: "ann@example.com", label: "Email", kind: "email" });
    expect(email).toBe(
      `<form class="prop" data-write-on="blur"><label class="prop-name cap" for="field-trip-people-2-email">Email</label><div class="prop-value">` +
        `<input class="field" id="field-trip-people-2-email" name="email"${write("trip", "replace", "/people/2/email")} type="email" value="ann@example.com" autocomplete="off"></div></form>`,
    );
    // what is typed is written as it is left; a date, a choice or a tick as it is made; a reading as it is typed, if asked
    const on = (o: Partial<FieldOptions>) => field({ doc: "trip", path: "/x", value: null, label: "X", ...o }).match(/data-write-on="(\w+)"/)![1];
    expect([on({}), on({ kind: "number" }), on({ kind: "textarea" }), on({ kind: "date" }), on({ kind: "select" }), on({ kind: "checkbox" }), on({ on: "input" })]).toEqual(["blur", "blur", "blur", "change", "change", "change", "input"]);
    // a textarea keeps a value that starts with a newline: the parser drops only the one drawn before it
    expect(field({ doc: "trip", path: "/notes", value: "\nfirst", label: "Notes", kind: "textarea", placeholder: "a line" })).toContain(`placeholder="a line" rows="3">\n\nfirst</textarea>`);
    const kinds = [{ value: "see", text: "See" }, { value: "eat", text: "Eat & drink" }];
    expect(field({ doc: "trip", path: "/kind", value: "eat", label: "Kind", kind: "select", options: kinds })).toContain(`<option value="see">See</option><option value="eat" selected>Eat &amp; drink</option></select>`);
    expect(field({ doc: "trip", path: "/kind", value: null, label: "Kind", kind: "select" })).toContain(`${write("trip", "replace", "/kind")}></select>`);
    expect(field({ doc: "trip", path: "/booked", value: true, label: "Booked", kind: "checkbox" })).toContain(`type="checkbox" checked></div></form>`);
    expect(field({ doc: "trip", path: "/booked", value: false, label: "Booked", kind: "checkbox" })).toContain(`type="checkbox"></div></form>`);
    // what this person was told at it, beside it, and what it is described by
    const told = field({ doc: "room:general", path: "/topic", value: "Tea", label: "Topic", said: `<p class="refused" role="alert">No.</p>` });
    expect(told).toContain(`id="field-room-general-topic" name="topic"${write("room:general", "replace", "/topic")} aria-describedby="field-room-general-topic-said"`);
    expect(told).toContain(`<div class="field-said" id="field-room-general-topic-said"><p class="refused" role="alert">No.</p></div></div></form>`);
    // one of a row's own: heard by its label, laid out by the row
    expect(field({ doc: "trip", path: "/dishes/3/name", value: "Soup", label: "Dish", inRow: true })).toStartWith(`<form class="in-row" data-write-on="blur"><label class="sr-only" for="field-trip-dishes-3-name">Dish</label><input class="field"`);
    // the permit says no: read, not a control
    expect(field({ doc: "trip", path: "/x", value: "<b>", label: "X", may: false })).toBe(prop("X", "&lt;b&gt;"));
    expect(field({ doc: "trip", path: "/kind", value: "eat", label: "Kind", kind: "select", options: kinds, may: false })).toBe(prop("Kind", "Eat &amp; drink"));
    expect(field({ doc: "trip", path: "/kind", value: "fly", label: "Kind", kind: "select", may: false })).toBe(prop("Kind", ""));
    expect([true, false].map((value) => field({ doc: "trip", path: "/b", value, label: "B", kind: "checkbox", may: false }))).toEqual([prop("B", "Yes"), prop("B", "No")]);
    expect(field({ doc: "trip", path: "/x", value: 3, label: "X", may: false, inRow: true })).toBe(`<span class="field">3</span>`);
  });

  test("the modals: adding asks for the fields it needs, removing asks one question; cancelling writes the session", () => {
    const close = write("desk", "replace", "/page", "rooms");
    const add = b.addModal("A new room", [{ name: "room", label: "Its name" }, { name: "seats", label: "Seats", type: "number", required: false, value: "4", placeholder: "how many" }], open, close);
    expect(add).toContain(`<div class="scrim modal-scrim" data-escape${close}></div><dialog open class="modal" aria-label="A new room"><h3>A new room</h3><form${open}>`);
    expect(add).toContain('<input name="room" type="text" value="" placeholder="" autocomplete="off" required autofocus>');
    expect(add).toContain('<input name="seats" type="number" min="0" step="any" value="4" placeholder="how many" autocomplete="off">');
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

describe("collectionsWrite: a session's permit and shape for the bento's own writes", () => {
  const replace = (path: string, value?: unknown) => ({ op: "replace" as const, path, value });
  const remove = (path: string) => ({ op: "remove" as const, path });

  test("permitted: a reading switched, find's word and its eye set or put away, each by a collection's name; nothing else", () => {
    for (const op of [replace("/reading/board", "list"), replace("/filter/market", ""), remove("/filter/market"), replace("/hide/market", true), remove("/hide/market")]) expect([op, collectionsWrite(op)]).toEqual([op, expect.any(Array)]);
    for (const op of [remove("/reading/board"), { op: "add" as const, path: "/hide/market", value: true }, replace("/reading"), replace("/filter/market/x"), replace("/page", "board")]) expect([op, collectionsWrite(op)]).toEqual([op, undefined]);
  });

  test("shaped: applied to the session's own, each of reading, filter and hide it moves replaced whole, null once empty; one that moves nothing, none", () => {
    const ui: Collections = { filter: { market: "al" }, hide: { market: true } };
    expect(collectionsWrite(replace("/reading/board", "list"), ui)).toEqual([{ op: "replace", path: "/reading", value: { board: "list" } }]);
    expect(collectionsWrite(remove("/filter/market"), ui)).toEqual([{ op: "replace", path: "/filter", value: null }, { op: "replace", path: "/hide", value: null }]);
    expect(collectionsWrite(remove("/hide/market"), ui)).toEqual([]);
    expect(ui).toEqual({ reading: { board: "list" } });
  });
});

describe("the stylesheet", () => {
  test("bento.css nests no rule in another: a browser without CSS nesting (Safari before 16.5, Chrome before 112) drops the whole block", async () => {
    const css = (await Bun.file(new URL("./bento.css", import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");
    const within: string[] = []; // the preludes of the blocks we are in
    const nested: string[] = [];
    for (const [, prelude, mark] of css.matchAll(/([^{};]*)([{};])/g)) {
      if (mark === "{") {
        if (within.some((p) => !p.startsWith("@"))) nested.push(prelude!.trim());
        within.push(prelude!.trim());
      } else if (mark === "}") within.pop();
    }
    expect(nested).toEqual([]);
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
    const view = webview({ width, height: 740 });
    await view.navigate(server.url.toString());
    await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
    await view.evaluate(`(() => { window.__sent = []; window.eta.socket().send = (data) => { const { id, ...write } = JSON.parse(data); window.__sent.push(write); }; })()`);
    await draw(view, html);
    return view;
  }

  /** The server drawing the page again. */
  async function draw(view: Bun.WebView, html: string): Promise<void> {
    const payload = renderMessage(html);
    await view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(payload)} }))`);
    await waitFor(view, `document.getElementById('app').innerHTML.length > 0`, (v) => v === true);
  }

  /** A page as an app draws it: in the bento's frame, with nothing open over it. */
  const framed = (page: string): string => layers(page, "", "");

  const sent = (view: Bun.WebView) => view.evaluate<{ doc: string; ops: { op: string; path: string; value?: unknown }[] }[]>(`window.__sent`);
  const go = (page: string) => write("desk", "replace", "/page", page);

  /** Every control on the page that can take the keyboard, by the words it says. */
  const reachable = (view: Bun.WebView) =>
    view.evaluate<string[]>(`[...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) => { el.focus(); return document.activeElement === el; }).map((el) => el.textContent.trim() || el.getAttribute('aria-label'))`);

  test("behind an open window nothing is reached or heard: the trail, the other cells and what is in place are inert", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "market", opens: go("market") }), b.cell({ name: "clock", thing: { open: go("?clock"), chosen: false } })];
    const trail = [{ label: "The desk", back: go("") }, { label: "the market" }];
    const inPlace = [`<button type="button" class="tool">Say</button>`];
    await using view = await show(framed(b.boxPage(trail, inPlace, cells, { key: "market", tools: [b.tool("Find", { icon: "search", iconOnly: true, write: go("market?find") })], body: rows([b.row({ tap: go("market?symbol=A"), what: "Alpha" })], "none") })));
    // the window's own: its way back, its tool, its row, the page's tools
    expect(await reachable(view)).toEqual(["The desk", "Find", "Alpha", "Undo", "Redo", "Leave"]);
  });

  /** Whether a press `off` px from the middle of each element `selector` matches, up or down (and to each side when it is narrower than that), lands on it. */
  const pressesAround = (view: Bun.WebView, selector: string, off: string) =>
    view.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].flatMap((el) => {
      const r = el.getBoundingClientRect(), off = parseFloat(${off}) / 2 - 1, x = r.left + r.width / 2, y = r.top + r.height / 2;
      const at = [[x, y - off], [x, y + off], ...(r.width < 2 * off ? [[x - off, y], [x + off, y]] : [])];
      return at.filter(([px, py]) => !el.contains(document.elementFromPoint(px, py))).map(([px, py]) => el.textContent.trim() + ' misses ' + Math.round(px - x) + ',' + Math.round(py - y));
    })`);
  const touch = `getComputedStyle(document.documentElement).getPropertyValue('--touch')`;

  for (const width of [320, 375, 768]) {
    test(`on a phone ${width} wide (the phone's rules hold below 820): no field is under 16px, find's field fills its bar, and a way back on the trail is a touch tall where it is pressed`, async () => {
      const cells = [b.cell({ name: "market", opens: go("market") })];
      // the box on a ground of its own, its trail three deep: the root, a way back, where you are
      await using view = await show(framed(b.boxPage([{ label: "Eta" }, { label: "Chat", back: go("") }, { label: "The desk" }], [], cells)), width);
      expect(await pressesAround(view, ".crumbs a", touch)).toEqual([]);

      const find = b.findControl("market", { word: "", shown: 3, total: 3 });
      const window_ = b.boxPage([{ label: "The desk", back: go("") }, { label: "the market" }], [], cells, { key: "market", tools: [find.tool], filter: find.filter, body: rows([b.row({ tap: go("?a"), what: "Alpha" })], "none") });
      const asks = b.addModal("Watch a symbol", [{ name: "symbol", label: "Which" }, { name: "kind", label: "Kind", options: [{ value: "a", text: "a" }] }], go("new"), go(""));
      const drawer = b.drawer("d", "Notes", `<form data-write-on="blur"><textarea name="n"></textarea></form>`, go(""));
      await draw(view, layers(window_, drawer, asks));
      await waitFor(view, `document.querySelectorAll('input, select, textarea').length`, (v) => v === 4);
      const sizes = await view.evaluate<string[]>(`[...document.querySelectorAll('input, select, textarea')].map((el) => (el.name || el.type) + ' ' + getComputedStyle(el).fontSize)`);
      expect(sizes).toEqual(["q 16px", "n 16px", "symbol 16px", "kind 16px"]);

      // find's bar is the row under the trail; its field takes what the tally and the eye leave, and the eye keeps its size inside it
      const bar = await view.evaluate<{ gap: number; eye: number; end: number }>(`(() => {
        const bar = document.querySelector('.filter').getBoundingClientRect(), field = document.querySelector('.filter input').getBoundingClientRect();
        const tally = document.querySelector('.filter .tally').getBoundingClientRect(), eye = document.querySelector('.filter .tool').getBoundingClientRect();
        return { gap: Math.round(tally.left - field.right), eye: Math.round(eye.width), end: Math.round(bar.right - eye.right) };
      })()`);
      // the field up to the tally, the bar's gap between; the eye whole, at the bar's end (its padding and border from it)
      expect(bar).toEqual({ gap: 8, eye: 26, end: 3 });
    });
  }

  /** Presses over each element's press area (--touch each way, or itself where it is bigger) that land on another control. */
  const pressesElsewhere = (view: Bun.WebView, selector: string) =>
    view.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].flatMap((el) => {
      const r = el.getBoundingClientRect(), touch = parseFloat(${touch}), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hw = Math.max(r.width, touch) / 2 - 1, hh = Math.max(r.height, touch) / 2 - 1, out = [];
      for (const dx of [-hw, -hw / 2, 0, hw / 2, hw]) for (const dy of [-hh, -hh / 2, 0, hh / 2, hh]) {
        const hit = document.elementFromPoint(x + dx, y + dy)?.closest('a, button, input');
        if (hit && hit !== el && !el.contains(hit)) out.push(el.textContent.trim() + ' at ' + Math.round(dx) + ',' + Math.round(dy) + ' is ' + hit.textContent.trim());
      }
      return out;
    })`);

  for (const width of [320, 375]) {
    test(`${width} wide, a trail that wraps: each way back is pressed over a touch, and a press on one never lands on another`, async () => {
      const trail = [{ label: "Nick & Nora", back: go("a") }, { label: "The Okafors", back: go("b") }, { label: "Where to stay", back: go("c") }, { label: "the market" }];
      await using view = await show(framed(b.boxPage(trail, [], [b.cell({ name: "market", opens: go("market") })])), width);
      expect(await view.evaluate<number>(`new Set([...document.querySelectorAll('.crumbs a, .crumbs b')].map((e) => Math.round(e.getBoundingClientRect().top))).size`)).toBeGreaterThan(1); // it wraps
      expect(await pressesElsewhere(view, ".crumbs a")).toEqual([]);
      expect(await pressesAround(view, ".crumbs a", touch)).toEqual([]);
    });
  }

  for (const width of [375, 1280]) {
    test(`${width} wide: find's eye and a way back in the window are drawn 26px, and pressed over a touch`, async () => {
      const cells = [b.cell({ name: "market", opens: go("market") })];
      const find = b.findControl("market", { word: "al", shown: 1, total: 3 });
      await using view = await show(framed(b.boxPage([{ label: "The desk", back: go("") }, { label: "the market" }], [], cells, { key: "market", tools: [find.tool], filter: find.filter, body: "" })), width);
      expect(await view.evaluate<number[]>(`['.filter .tool', '.cell.open .cell-back'].map((s) => document.querySelector(s).getBoundingClientRect().height)`)).toEqual([26, 26]);
      expect(await pressesAround(view, ".filter .tool, .cell.open .cell-back", touch)).toEqual([]);
    });
  }

  test("opening a window moves nothing else: the tray, the cell that grows and what is in place are the same elements, and what is typed in place stays", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "market", opens: go("market"), summary: "16 symbols" })];
    const inPlace = [`<p class="note">said once</p>`, `<form id="say"><input name="t" value=""></form>`];
    const closed = framed(b.boxPage([{ label: "The desk" }], inPlace, cells));
    const opened = framed(b.boxPage([{ label: "The desk", back: go("") }, { label: "the market" }], inPlace, cells, { key: "market", body: "" }));
    await using view = await show(closed);
    await view.evaluate(`(() => { window.__was = ['.cells', '[data-moving="market"]', '#say'].map((s) => document.querySelector(s)); document.querySelector('#say input').value = 'half typed'; })()`);
    const same = `['.cells', '[data-moving="market"]', '#say'].map((s, i) => document.querySelector(s) === window.__was[i]).concat(document.querySelector('#say input').value)`;
    await draw(view, opened);
    await waitFor(view, `document.querySelector('.cell.open') !== null`, (v) => v === true);
    expect(await view.evaluate<unknown[]>(same)).toEqual([true, true, true, "half typed"]);
    await draw(view, closed);
    await waitFor(view, `document.querySelector('.cell.open') === null`, (v) => v === true);
    expect(await view.evaluate<unknown[]>(same)).toEqual([true, true, true, "half typed"]);
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
      // what a screen reader says as the keyboard goes in: the window, by its name
      expect(await view.evaluate<string[]>(`(() => { const w = document.activeElement.closest('.cell.open'); return [w.getAttribute('role'), w.getAttribute('aria-label')]; })()`)).toEqual(["region", "the market"]);

      await view.evaluate(`document.activeElement.click()`); // the way back, as Enter on it would
      expect((await sent(view)).at(-1)).toEqual({ doc: "desk", ops: [{ op: "replace", path: "/page", value: "" }] });
      await send(view, 0, close);
      await waitFor(view, `document.querySelector('.cell.open') === null`, (v) => v === true);
      expect(await waitFor(view, focused, (v) => v === "market market", 1000).catch(() => view.evaluate(focused))).toBe("market market");
    });
  }

  /** Where the keyboard is: the words of what has it, or nowhere -- the page itself, or something inert. */
  const keyboard = `(() => { const at = document.activeElement; return !at || at === document.body || at.closest('[inert]') ? 'nowhere' : at.textContent.trim() || at.getAttribute('aria-label') || at.name; })()`;
  const at = (view: Bun.WebView, where: string) => waitFor(view, keyboard, (v) => v === where, 1000).catch(() => view.evaluate(keyboard));

  test("the keyboard is never left nowhere: Escape puts a drawer away and the keyboard goes back to what opened it", async () => {
    const page = (open: boolean) => {
      const list = rows([b.row({ id: "r-a", tap: go(open ? "" : "?a"), chosen: open, what: "Alpha" }), b.row({ id: "r-b", tap: go("?b"), chosen: false, what: "Beta" })], "none");
      const box = b.collectionPage([{ label: "The desk" }], { key: "market", body: list });
      return layers(box, open ? b.drawer("a", "Alpha", `<form data-write-on="blur"><input name="note" value="" aria-label="Note"></form>`, go("")) : "", "");
    };
    await using view = await show(page(false));
    await view.evaluate(`document.getElementById('r-a').focus()`);
    await view.press("Space");
    await draw(view, page(true));
    await waitFor(view, `document.querySelector('.drawer') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.drawer input').focus()`);
    await view.press("Escape");
    expect((await sent(view)).at(-1)).toEqual({ doc: "desk", ops: [{ op: "replace", path: "/page", value: "" }] });
    await draw(view, page(false));
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
    expect(await at(view, "Alpha")).toBe("Alpha");
  });

  test("the keyboard is never left nowhere: a modal's field takes it though what opened the modal is inert, and Escape gives it back", async () => {
    const plus = b.addTool(go("?new"), "Watch a symbol");
    const page = (asking: boolean) =>
      layers(b.collectionPage([{ label: "The desk" }], { key: "board", tools: [plus], body: "" }), "", asking ? b.addModal("Watch a symbol", [{ name: "symbol", label: "Which" }], write("watchlist", "add", "/symbols/-"), go("")) : "");
    await using view = await show(page(false));
    await view.evaluate(`document.querySelector('[aria-label="Watch a symbol"]').focus()`);
    await view.press("Space");
    await draw(view, page(true));
    await waitFor(view, `document.querySelector('dialog') !== null`, (v) => v === true);
    expect(await at(view, "symbol")).toBe("symbol");
    await view.press("Escape");
    await draw(view, page(false));
    await waitFor(view, `document.querySelector('dialog') === null`, (v) => v === true);
    expect(await at(view, "Watch a symbol")).toBe("Watch a symbol");
  });

  test("the keyboard is never left nowhere: a window opened by back or forward takes it from the cell it put behind", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "market", opens: go("market") })];
    await using view = await show(framed(b.boxPage([{ label: "The desk" }], [], cells)));
    await view.evaluate(`document.querySelector('.cell[data-key="board"] button').focus()`);
    // the back button: the session goes to the market, and the page comes without a press
    await draw(view, framed(b.boxPage([{ label: "The desk", back: go("") }, { label: "the market" }], [], cells, { key: "market", body: "" })));
    await waitFor(view, `document.querySelector('.cell.open') !== null`, (v) => v === true);
    expect(await at(view, "The desk")).toBe("The desk");
  });

  test("a drawer docked beside a window takes the window's curve at its outer corners; a field in a property keeps a field's height; a select's focus is the bento's ring", async () => {
    const body = `<div class="props">${field({ doc: "desk", path: "/name", value: "Alpha", label: "Name" })}${field({ doc: "desk", path: "/kind", value: "a", label: "Kind", kind: "select", options: [{ value: "a", text: "a" }] })}</div>`;
    const page = layers(b.collectionPage([{ label: "The desk" }], { key: "market", body: "" }), b.drawer("d", "Alpha", body, go("")), "");
    await using view = await show(page, 1280);
    const corners = `['.cell.open', '.drawer'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.borderTopRightRadius, c.borderBottomRightRadius]; })`;
    const [window_, drawer] = await view.evaluate<string[][]>(corners);
    expect(drawer).toEqual(window_!);
    // the value's column is a column: a field there is a touch tall, not its text's height
    expect(await view.evaluate<number[]>(`[...document.querySelectorAll('.prop-value > .field')].map((f) => f.getBoundingClientRect().height)`)).toEqual([40, 40]);
    // from the name to the kind, as the keyboard goes (WebKit's Tab passes a select by, unless the Mac says otherwise): the select shows it has the keyboard, in the accent
    await view.evaluate(`(document.querySelector('input.field').focus(), document.querySelector('select').focus())`);
    await view.evaluate(`document.querySelector('.cell-name').style.color = 'var(--accent)'`);
    const ring = `(() => { const s = document.activeElement, c = getComputedStyle(s); return [s.tagName, s.matches(':focus-visible'), c.outlineStyle, c.outlineColor === getComputedStyle(document.querySelector('.cell-name')).color]; })()`;
    expect(await view.evaluate<unknown[]>(ring)).toEqual(["SELECT", true, "solid", true]);
  });

  test("a field drawn in one call writes as a person uses it: its label takes the caret to it, what is typed goes as it is left with what it was drawn with, a tick as it is made; one in a row takes what the row leaves; a status says nothing until told", async () => {
    const fields = join(
      `<div class="props">`,
      field({ doc: "desk", path: "/note", value: "Tea", label: "Note", said: "" }),
      field({ doc: "desk", path: "/booked", value: false, label: "Booked", kind: "checkbox" }),
      `<div class="pair" style="display: flex">${field({ doc: "desk", path: "/dish", value: "Soup", label: "Dish", inRow: true })}${b.tool("Remove", { write: go(""), iconOnly: true, icon: "trash" })}</div>`,
      `</div>`,
    );
    await using view = await show(layers(b.collectionPage([{ label: "The desk" }], { key: "market", body: "" }), b.drawer("d", "Alpha", fields, go("")), ""));
    await view.evaluate(`document.querySelector('label[for="field-desk-note"]').click()`);
    expect(await view.evaluate<string>(`document.activeElement.id`)).toBe("field-desk-note");
    expect(await view.evaluate<number>(`document.getElementById('field-desk-note-said').getBoundingClientRect().height`)).toBe(0);
    await view.evaluate(`(() => { const f = document.activeElement; f.value = 'Coffee'; f.dispatchEvent(new Event('input', { bubbles: true })); f.blur(); })()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect((await sent(view)).at(-1)).toEqual({ doc: "desk", ops: [{ op: "test", path: "/note", value: "Tea" }, { op: "replace", path: "/note", value: "Coffee" }] });
    await view.evaluate(`document.getElementById('field-desk-booked').click()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    expect((await sent(view)).at(-1)).toEqual({ doc: "desk", ops: [{ op: "replace", path: "/booked", value: true }] });
    const row = await view.evaluate<number[]>(`['.pair', '.pair input', '.pair .tool'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width))`);
    expect(row[1]! + row[2]!).toBeGreaterThan(row[0]! - 20); // the field and the button fill the row, between them
  });

  test("bento.css draws the frame and nothing else: an app's own elements beside it are as the browser draws them", async () => {
    const plain = `<button type="button">b</button><input aria-label="i"><select aria-label="s"><option>o</option></select><textarea aria-label="t"></textarea><a href="#">a</a><details><summary>s</summary></details><div style="padding: 10px; width: 50px"></div><p hidden style="display: block">h</p>`;
    await using view = await show(`<div id="own">${plain}</div><div id="bare"></div>${framed(`<div id="framed">${plain}</div>`)}`);
    const unlike = await view.evaluate<Record<string, string[]>>(`(() => {
      // the same elements in a shadow root, where no page's stylesheet reaches: the browser's own look
      const bare = document.getElementById('bare').attachShadow({ mode: 'open' });
      bare.innerHTML = document.getElementById('own').innerHTML;
      const look = (el) => { const c = getComputedStyle(el); let s = ''; for (let i = 0; i < c.length; i++) s += c[i] + ':' + c.getPropertyValue(c[i]) + ';'; return s; };
      const unlike = (id) => [...document.getElementById(id).children].filter((el, i) => look(el) !== look(bare.children[i])).map((el) => el.tagName.toLowerCase());
      return { own: unlike('own'), framed: unlike('framed') };
    })()`);
    expect(unlike).toEqual({ own: [], framed: ["button", "input", "select", "textarea", "a", "details", "div", "p"] });
  });

  // a wheel over the page, as a person scrolls it: whether the page moved
  const wheels = async (view: Bun.WebView): Promise<boolean> => {
    const from = await view.evaluate<number>(`scrollY`);
    await view.scroll(0, 300);
    return waitFor(view, `scrollY`, (y) => y !== from, 1000).then(() => true, () => false);
  };

  for (const width of [375, 1280]) {
    test(`${width} wide, whatever the app calls its root: a modal holds the page behind it still; a drawer does ${width < 820 ? "too, its sheet over the page" : "not, docked beside a page still in reach"}`, async () => {
      const box = b.boxPage([{ label: "The desk" }], [`<div style="height: 3000px"></div>`], [b.cell({ name: "clock", thing: { open: go("?clock"), chosen: false } })]);
      const trip = (drawer: string, modal: string) => `<div class="trip">${layers(box, drawer, modal)}</div>`;
      await using view = await show(trip(b.drawer("clock", "The clock", "", go("")), ""), width);
      expect(await wheels(view)).toBe(width >= 820);
      await draw(view, trip("", b.confirmModal("Stop the clock", "Sure?", go("?stop"), go(""))));
      await waitFor(view, `!!document.querySelector('dialog')`, (v) => v === true);
      expect(await wheels(view)).toBe(false);
      await draw(view, trip("", ""));
      await waitFor(view, `!document.querySelector('dialog')`, (v) => v === true);
      expect(await wheels(view)).toBe(true);
    });
  }

  test("what opens is a button: each cell, thing and row that opens is where a Tab stops, and Space or Enter opens it", async () => {
    const cells = [b.cell({ name: "board", opens: go("board") }), b.cell({ name: "clock", thing: { open: go("?clock"), chosen: false } }), b.cell({ name: "quiet" })];
    const list = rows([b.row({ id: "r-a", tap: go("?symbol=A"), what: "Alpha", mark: "pencil" }), b.row({ id: "r-b", what: "Beta" })], "none");
    await using view = await show(framed(b.boxPage([{ label: "The desk" }], [list], cells)));
    // where a Tab stops in each: the element itself, or what in it takes the keyboard
    const stop = (selector: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el.matches('button, a[href], [tabindex]') ? el : el.querySelector('button, a[href], [tabindex]'); })()`;
    const opens: [string, string][] = [['.cell[data-key="board"]', "board"], ['.cell[data-key="clock"]', "?clock"], ["#r-a", "?symbol=A"]];
    for (const [selector, page] of opens) {
      await view.evaluate(`(window.__sent = [], ${stop(selector)}.focus())`);
      await view.press("Space");
      await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000).catch(() => {});
      expect({ selector, sent: await sent(view) }).toEqual({ selector, sent: [{ doc: "desk", ops: [{ op: "replace", path: "/page", value: page }] }] });
      expect(await view.evaluate<string>(`${stop(selector)}.tagName`)).toBe("BUTTON"); // so Enter opens it too: the browser's own
      await view.press("Enter");
      await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    }
    // what only reads is not a stop at all
    expect(await view.evaluate<boolean>(`document.querySelector('.cell[data-key="quiet"]').matches(':is(button, [tabindex]), :has(button, [tabindex])')`)).toBe(false);
    expect(await view.evaluate<boolean>(`document.getElementById('r-b').matches(':is(button, [tabindex]), :has(button, [tabindex])')`)).toBe(false);
  });
});
