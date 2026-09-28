import { describe, expect, test } from "bun:test";
import { appletProps } from "./html";
import { comparable, diff, drawParts, part, splitTag } from "./parts";

const draw = (render: () => string) => drawParts(render);
const list = (key: string, rows: [string, string][]) => part(key, `<ul>${rows.map(([k, t]) => part(k, `<li>${t}</li>`)).join("")}</ul>`);
const page = (head: string, rows: [string, string][]) => `<main>${part("head", `<h1>${head}</h1>`)}${list("list", rows)}</main>`;

describe("part", () => {
  test("tags the region's root element, and outside a drawing only tags", () => {
    expect(part("a", `<div class="x">hi</div>`)).toBe(`<div data-eta-part="a" class="x">hi</div>`);
    expect(part('q"k', `<p>x</p>`)).toBe(`<p data-eta-part="q&quot;k">x</p>`);
  });
});

describe("splitTag", () => {
  test("an opening tag and the rest, a `>` inside a quoted value no end; a tag that never ends is all tag", () => {
    expect(splitTag(`<div title="a>b" data-x='c>d'>in</div>`)).toEqual([`<div title="a>b" data-x='c>d'>`, "in</div>"]);
    expect(splitTag(`<div title="a>b`)).toEqual([`<div title="a>b`, ""]);
  });
});

describe("diff", () => {
  test("nothing changed: nothing to send", () => {
    const one = draw(() => page("Hi", [["r1", "a"]]));
    expect(diff(one, draw(() => page("Hi", [["r1", "a"]])))).toEqual([]);
  });

  test("one part changed: that part alone", () => {
    const one = draw(() => page("Hi", [["r1", "a"], ["r2", "b"]]));
    expect(diff(one, draw(() => page("Hello", [["r1", "a"], ["r2", "B"]])))).toEqual([
      { op: "replace", target: '[data-eta-part="head"]', html: `<h1 data-eta-part="head">Hello</h1>` },
      { op: "replace", target: '[data-eta-part="r2"]', html: `<li data-eta-part="r2">B</li>` },
    ]);
  });

  test("a row added at the end goes after the one before it; at the start, before the one after it; a row gone is taken out", () => {
    const one = draw(() => page("Hi", [["r1", "a"], ["r2", "b"]]));
    expect(diff(one, draw(() => page("Hi", [["r0", "z"], ["r1", "a"], ["r3", "c"]])))).toEqual([
      { op: "remove", target: '[data-eta-part="r2"]' },
      { op: "before", target: '[data-eta-part="r1"]', html: `<li data-eta-part="r0">z</li>` },
      { op: "after", target: '[data-eta-part="r1"]', html: `<li data-eta-part="r3">c</li>` },
    ]);
  });

  test("a list that was empty, or whose rows changed order, is replaced whole", () => {
    const empty = draw(() => page("Hi", []));
    expect(diff(empty, draw(() => page("Hi", [["r1", "a"]])))).toEqual([{ op: "replace", target: '[data-eta-part="list"]', html: `<ul data-eta-part="list"><li data-eta-part="r1">a</li></ul>` }]);
    const two = draw(() => page("Hi", [["r1", "a"], ["r2", "b"]]));
    expect(diff(two, draw(() => page("Hi", [["r2", "b"], ["r1", "a"]])))).toEqual([
      { op: "replace", target: '[data-eta-part="list"]', html: `<ul data-eta-part="list"><li data-eta-part="r2">b</li><li data-eta-part="r1">a</li></ul>` },
    ]);
  });

  test("a list's own outline changed: the list whole", () => {
    const one = draw(() => page("Hi", [["r1", "a"]]));
    const other = draw(() => `<main>${part("head", `<h1>Hi</h1>`)}${part("list", `<ol>${part("r1", `<li>a</li>`)}</ol>`)}</main>`);
    expect(diff(one, other)).toEqual([{ op: "replace", target: '[data-eta-part="list"]', html: `<ol data-eta-part="list"><li data-eta-part="r1">a</li></ol>` }]);
  });

  test("the page's own outline changed: the page goes whole", () => {
    const one = draw(() => page("Hi", [["r1", "a"]]));
    expect(diff(one, draw(() => `<section>${part("head", `<h1>Hi</h1>`)}</section>`))).toBeUndefined();
  });

  test("a key named twice on a page is no part: what holds it is sent", () => {
    const one = draw(() => `<main>${part("box", `<div>${part("x", `<b>1</b>`)}${part("x", `<b>2</b>`)}</div>`)}</main>`);
    const two = draw(() => `<main>${part("box", `<div>${part("x", `<b>1</b>`)}${part("x", `<b>3</b>`)}</div>`)}</main>`);
    expect(diff(one, two)).toEqual([{ op: "replace", target: '[data-eta-part="box"]', html: `<div data-eta-part="box"><b data-eta-part="x">1</b><b data-eta-part="x">3</b></div>` }]);
  });

  test("a part whose own tag changed and nothing inside it: the tag alone, then what is inside", () => {
    const view = (cls: string, t: string) => `<main>${part("site", `<div class="${cls}" data-note='a>b'>${part("head", `<h1>${t}</h1>`)}<p>x</p></div>`)}</main>`;
    expect(diff(draw(() => view("site", "Hi")), draw(() => view("site locked", "Hi")))).toEqual([
      { op: "tag", target: '[data-eta-part="site"]', html: `<div data-eta-part="site" class="site locked" data-note='a>b'>` },
    ]);
    expect(diff(draw(() => view("site", "Hi")), draw(() => view("site locked", "Ho")))).toEqual([
      { op: "tag", target: '[data-eta-part="site"]', html: `<div data-eta-part="site" class="site locked" data-note='a>b'>` },
      { op: "replace", target: '[data-eta-part="head"]', html: `<h1 data-eta-part="head">Ho</h1>` },
    ]);
  });

  test("a list whose own tag changed as rows came: the tag, and the row", () => {
    const view = (cls: string, rows: string[]) => `<main>${part("list", `<ul class="${cls}">${rows.map((r) => part(r, `<li>${r}</li>`)).join("")}</ul>`)}</main>`;
    expect(diff(draw(() => view("a", ["r1"])), draw(() => view("b", ["r1", "r2"])))).toEqual([
      { op: "tag", target: '[data-eta-part="list"]', html: `<ul data-eta-part="list" class="b">` },
      { op: "after", target: '[data-eta-part="r1"]', html: `<li data-eta-part="r2">r2</li>` },
    ]);
  });

  test("a drawer opening over a page: the drawer's layer, and the site's tag", () => {
    const view = (drawer: string) => part("site", `<div class="site${drawer ? " locked" : ""}">${part("page", `<p>page</p>`)}${part("drawers", `<div class="layer">${drawer}</div>`)}</div>`);
    expect(diff(draw(() => view("")), draw(() => view("<aside>d</aside>")))).toEqual([
      { op: "tag", target: '[data-eta-part="site"]', html: `<div data-eta-part="site" class="site locked">` },
      { op: "replace", target: '[data-eta-part="drawers"]', html: `<div data-eta-part="drawers" class="layer"><aside>d</aside></div>` },
    ]);
  });

  test("a part that moves from one parent part to another is taken out of the one it left, not the first on the page", () => {
    const view = (at: "a" | "b") => part("root", `<div>${["a", "b"].map((k) => part(k, `<section>${at === k ? part("head", "<header>H</header>") : ""}</section>`)).join("")}</div>`);
    expect(diff(draw(() => view("b")), draw(() => view("a")))).toEqual([
      { op: "replace", target: '[data-eta-part="a"]', html: `<section data-eta-part="a"><header data-eta-part="head">H</header></section>` },
      { op: "remove", target: '[data-eta-part="b"] [data-eta-part="head"]' },
    ]);
    expect(diff(draw(() => view("a")), draw(() => view("b")))).toEqual([
      { op: "remove", target: '[data-eta-part="a"] [data-eta-part="head"]' },
      { op: "replace", target: '[data-eta-part="b"]', html: `<section data-eta-part="b"><header data-eta-part="head">H</header></section>` },
    ]);
  });

  // two days of stops, the tea moving between them; and a split before them, which draws what it
  // holds twice, as columns and as rows, so that there it is no part
  const days = (tea: "mon" | "tue" | "split") => {
    const row = (how = "") => part("tea", `<li${how}>tea</li>`);
    const day = (d: string) => part(d, `<section><ul>${part(`${d}-walk`, `<li>walk</li>`)}${tea === d ? row() : ""}</ul></section>`);
    return `<main>${part("split", `<div><ul>${tea === "split" ? row(' class="col"') : ""}</ul><ol>${tea === "split" ? row(' class="row"') : ""}</ol></div>`)}${day("mon")}${day("tue")}</main>`;
  };

  test("a row that moves to another list is taken out of the list it left, named there: the one it went to may hold it already", () => {
    const tea = `<li data-eta-part="tea">tea</li>`;
    expect(diff(draw(() => days("tue")), draw(() => days("mon")))).toEqual([
      { op: "after", target: '[data-eta-part="mon-walk"]', html: tea },
      { op: "remove", target: '[data-eta-part="tue"] [data-eta-part="tea"]' },
    ]);
    expect(diff(draw(() => days("mon")), draw(() => days("tue")))).toEqual([
      { op: "remove", target: '[data-eta-part="mon"] [data-eta-part="tea"]' },
      { op: "after", target: '[data-eta-part="tue-walk"]', html: tea },
    ]);
  });

  test("so is a row the next page draws twice, and so as no part", () => {
    const [before, after] = [draw(() => days("mon")), draw(() => days("split"))];
    expect(after.nodes.has("tea")).toBe(false);
    expect(diff(before, after)).toEqual([
      { op: "replace", target: '[data-eta-part="split"]', html: after.nodes.get("split")!.html },
      { op: "remove", target: '[data-eta-part="mon"] [data-eta-part="tea"]' },
    ]);
  });

  test("a key drawn twice the same is one part", () => {
    const view = (t: string) => {
      const drawer = () => part("drawer", `<aside>${t}</aside>`);
      drawer(); // drawn, and not used
      return `<main>${drawer()}</main>`;
    };
    expect(diff(draw(() => view("a")), draw(() => view("b")))).toEqual([{ op: "replace", target: '[data-eta-part="drawer"]', html: `<aside data-eta-part="drawer">b</aside>` }]);
  });

  test("an applet that takes its document's patches is not sent its props when they alone change: they are the document, which reaches it as patches; any other applet's are", () => {
    const mount = (p: string, doc = ` data-doc="quote:ALPH"`, more = "") => `<main>${part("board", `<div data-applet="board"${doc}${more} data-props="${p}"></div>`)}</main>`;
    expect(diff(draw(() => mount("1")), draw(() => mount("2")))).toEqual([]);
    expect(diff(draw(() => mount("1", "")), draw(() => mount("2", "")))).toEqual([
      { op: "tag", target: '[data-eta-part="board"]', html: `<div data-eta-part="board" data-applet="board" data-props="2">` },
    ]);
    // they go with the mount's own tag, when something else on it changes: so what follows where a person is belongs off the mount
    expect(diff(draw(() => mount("1", undefined, ` aria-expanded="false"`)), draw(() => mount("2", undefined, ` aria-expanded="true"`)))).toEqual([
      { op: "tag", target: '[data-eta-part="board"]', html: `<div data-eta-part="board" data-applet="board" data-doc="quote:ALPH" aria-expanded="true" data-props="2">` },
    ]);
    expect(comparable(`<div data-doc="d" data-props="x"></div>`)).toBe(`<div data-doc="d"></div>`);
  });

  // an applet that watches a document: its props hold the document at `data-under`, beside small
  // props (who looks, what is open), and the server draws its first paint inside it
  const trip = (stops: Record<string, string>) => ({ legs: { "1": { place: "Kyoto" } }, stops });
  const watching = (small: { me: string; open?: string }, doc: object, paint: string, cls = "strip") =>
    `<div class="${cls}" id="strip" data-applet="strip"${appletProps({ ...small, trip: doc }, { doc: "trip:1", under: "/trip" })}><p>${paint}</p><div><i>${paint}</i></div></div>`;

  test("an applet that watches a document is sent nothing when only the document changed: not its props, nor what the server paints inside it", () => {
    const one = trip({ a: "Temple" });
    const two = trip({ a: "Temple", b: "Garden" });
    // the mount a part of its own, and not: inside a part, beside what else that part holds
    const own = (doc: object, paint: string) => `<main>${part("strip", watching({ me: "ann" }, doc, paint))}</main>`;
    const held = (doc: object, paint: string) => `<main>${part("day", `<section><h2>Day 1</h2>${watching({ me: "ann" }, doc, paint)}</section>`)}</main>`;
    expect(diff(draw(() => own(one, "1 stop")), draw(() => own(two, "2 stops")))).toEqual([]);
    expect(diff(draw(() => held(one, "1 stop")), draw(() => held(two, "2 stops")))).toEqual([]);
  });

  test("its small props, or anything else on its tag, changed: its tag goes, with the document as drawn now; what is beside it goes as ever", () => {
    const one = trip({ a: "Temple" });
    const two = trip({ a: "Temple", b: "Garden" });
    const own = (me: string, doc: object, cls?: string) => `<main>${part("strip", watching({ me }, doc, "paint", cls))}</main>`;
    const tag = (me: string, doc: object, cls = "strip") => splitTag(part("strip", watching({ me }, doc, "")))[0].replace(`class="strip"`, `class="${cls}"`);
    expect(diff(draw(() => own("ann", one)), draw(() => own("bo", two)))).toEqual([{ op: "tag", target: '[data-eta-part="strip"]', html: tag("bo", two) }]);
    expect(diff(draw(() => own("ann", one)), draw(() => own("ann", two, "strip open")))).toEqual([{ op: "tag", target: '[data-eta-part="strip"]', html: tag("ann", two, "strip open") }]);
    const held = (h2: string, doc: object) => `<main>${part("day", `<section><h2>${h2}</h2>${watching({ me: "ann" }, doc, "paint")}</section>`)}</main>`;
    expect(diff(draw(() => held("Day 1", one)), draw(() => held("Day one", two)))).toEqual([{ op: "replace", target: '[data-eta-part="day"]', html: part("day", `<section><h2>Day one</h2>${watching({ me: "ann" }, two, "paint")}</section>`) }]);
  });

  test("a watching mount that is a void element holds nothing inside it: what follows it is still compared", () => {
    for (const mount of [`<input data-applet="pick"${appletProps({ at: 1 }, { doc: "d:1" })}>`, `<img data-applet="pick"${appletProps({ at: 1 }, { doc: "d:1" })} />`]) {
      const page = (text: string) => `<main>${part("p", `<section>${mount}<p>${text}</p></section>`)}</main>`;
      expect(diff(draw(() => page("one")), draw(() => page("two")))).toEqual([{ op: "replace", target: '[data-eta-part="p"]', html: part("p", `<section>${mount}<p>two</p></section>`) }]);
    }
    expect(comparable(`<p><INPUT data-doc="d" data-props="{}">after</p>`)).toBe(`<p><INPUT data-doc="d">after</p>`);
    // a mount left open ends where what holds it ends, as a browser ends it: what follows is compared
    expect(comparable(`<main><div data-doc="d" data-props="{}"><p>paint<br></main><p>after</p>`)).toBe(`<main><div data-doc="d"></main><p>after</p>`);
  });

  test("comparable leaves out of a watching mount the document at `data-under` and all it holds; the root leaves out every prop", () => {
    const small = { me: "ann", open: "b" };
    expect(comparable(watching(small, trip({ a: "Temple" }), "painted"))).toBe(`<div class="strip" id="strip" data-applet="strip" data-doc="trip:1" data-under="/trip" data-props="{&quot;me&quot;:&quot;ann&quot;,&quot;open&quot;:&quot;b&quot;}"></div>`);
    expect(comparable(`<p>a</p><div data-applet="clock"${appletProps({ tz: "UTC" }, { doc: "clock" })}><b>12:00</b></div><p>b</p>`)).toBe(`<p>a</p><div data-applet="clock" data-doc="clock"></div><p>b</p>`);
    // props in single quotes, as an app may write them by hand, read the same
    expect(comparable(`<div data-doc="trip:1" data-under="/trip" data-props='{"me":"ann","trip":{"x":"it&#39;s"}}'></div>`)).toBe(`<div data-doc="trip:1" data-under="/trip" data-props="{&quot;me&quot;:&quot;ann&quot;}"></div>`);
    // deeper: only what is there
    expect(comparable(`<div data-doc="d" data-under="/a/b" data-props="{&quot;a&quot;:{&quot;b&quot;:1,&quot;c&quot;:2}}"></div>`)).toBe(`<div data-doc="d" data-under="/a/b" data-props="{&quot;a&quot;:{&quot;c&quot;:2}}"></div>`);
    // what it cannot read, or a document not where it says, it leaves as it is
    for (const tag of [`<div data-doc="d" data-under="/x" data-props="{&quot;y&quot;:1}">`, `<div data-doc="d" data-under="/x" data-props="not json">`, `<div data-doc="d" data-under="/x/y" data-props="{&quot;x&quot;:1}">`, `<div data-doc="d" data-under="/x">`]) expect(comparable(`${tag}</div>`)).toBe(`${tag}</div>`);
    // only an attribute of its own: another's value that says data-doc, a comment, a tag left open
    const said = `<div title=' data-doc="x"' data-props="{}"><!-- <div data-doc="y"> --></div>`;
    expect(comparable(said)).toBe(said);
    expect(comparable(`<div data-doc="d" data-props="{}"><p>never closed`)).toBe(`<div data-doc="d">`);
    // inside it, its own kind counted in and out, and a comment or a lone `<` no tag
    expect(comparable(`<div data-doc="d" data-props="{}"><!-- </div> -->1 <3 2<div title="</div>">x</div></div><p>after</p>`)).toBe(`<div data-doc="d"></div><p>after</p>`);
    expect(comparable(`<b data-doc="d"`)).toBe(`<b data-doc="d"`);
  });
});
