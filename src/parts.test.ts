import { describe, expect, test } from "bun:test";
import { comparable, diff, drawParts, part } from "./parts";

const draw = (render: () => string) => drawParts(render);
const list = (key: string, rows: [string, string][]) => part(key, `<ul>${rows.map(([k, t]) => part(k, `<li>${t}</li>`)).join("")}</ul>`);
const page = (head: string, rows: [string, string][]) => `<main>${part("head", `<h1>${head}</h1>`)}${list("list", rows)}</main>`;

describe("part", () => {
  test("tags the region's root element, and outside a drawing only tags", () => {
    expect(part("a", `<div class="x">hi</div>`)).toBe(`<div data-eta-part="a" class="x">hi</div>`);
    expect(part('q"k', `<p>x</p>`)).toBe(`<p data-eta-part="q&quot;k">x</p>`);
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

  test("a key drawn twice the same is one part", () => {
    const view = (t: string) => {
      const drawer = () => part("drawer", `<aside>${t}</aside>`);
      drawer(); // drawn, and not used
      return `<main>${drawer()}</main>`;
    };
    expect(diff(draw(() => view("a")), draw(() => view("b")))).toEqual([{ op: "replace", target: '[data-eta-part="drawer"]', html: `<aside data-eta-part="drawer">b</aside>` }]);
  });

  test("an applet that takes its document's patches is compared without its props", () => {
    const mount = (p: string) => `<main>${part("board", `<div data-applet="board" data-doc="ticker:market" data-props="${p}"></div>`)}</main>`;
    expect(diff(draw(() => mount("1")), draw(() => mount("2")))).toEqual([]);
    expect(comparable(`<div data-doc="d" data-props="x"></div>`)).toBe(`<div data-doc="d"></div>`);
  });
});
