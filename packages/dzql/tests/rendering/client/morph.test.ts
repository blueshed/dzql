import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor, webview } from "../../../src/rendering/webview";
import fixture from "./morph.test.html";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { "/": fixture } });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with a bare `#root` element and morph.ts loaded as `window.morph`. */
async function run(script: string): Promise<unknown> {
  await using view = webview();
  await view.navigate(server.url.toString());
  await waitFor(view, `typeof window.morph`, (v) => v === "function"); // the module script runs a moment after navigate() resolves

  // `return await`, not `return`: `await using`'s disposal runs as this function
  // returns, and would close the view out from under a still-pending evaluate().
  return await view.evaluate(`(() => { const root = document.querySelector('#root'); ${script} })()`);
}

describe("morph", () => {
  test("reuses an element in place when the tag matches, updating its attributes", async () => {
    const result = await run(`
      root.innerHTML = '<button class="old">Old</button>';
      const before = root.firstChild;
      before._probe = true;
      window.morph(root, '<button class="new">New</button>');
      return root.firstChild._probe === true && root.firstChild.className === "new" && root.firstChild.textContent === "New";
    `);
    expect(result).toBe(true);
  });

  test("replaces an element when the tag differs", async () => {
    const result = await run(`
      root.innerHTML = '<button>Old</button>';
      window.morph(root, '<span>New</span>');
      return root.firstChild.tagName === "SPAN" && root.firstChild.textContent === "New";
    `);
    expect(result).toBe(true);
  });

  test("matches children by id even when their order changes", async () => {
    const result = await run(`
      root.innerHTML = '<div id="a">A</div><div id="b">B</div>';
      root.querySelector("#a")._probe = "a";
      root.querySelector("#b")._probe = "b";
      window.morph(root, '<div id="b">B2</div><div id="a">A2</div>');
      return [...root.children].map((el) => \`\${el.id}:\${el._probe}:\${el.textContent}\`);
    `);
    expect(result).toEqual(["b:b:B2", "a:a:A2"]);
  });

  test("a child taken out or put in ahead of its siblings leaves them be: the button with the caret keeps it", async () => {
    const result = await run(`
      const day = (lead) => '<section>' + lead + '<h2>Day</h2><p>a stop</p><div><button>Go</button></div></section>';
      root.innerHTML = day('<span class="mark"></span>');
      const kept = () => [...root.querySelectorAll('h2, p, div, button')];
      const before = kept();
      root.querySelector('button').focus();
      window.morph(root, day(''));
      const out = [kept().every((el, i) => el === before[i]), document.activeElement === before[3]];
      window.morph(root, day('<em>new</em>'));
      out.push(kept().every((el, i) => el === before[i]), document.activeElement === before[3], root.firstChild.firstChild.tagName);
      return out;
    `);
    expect(result).toEqual([true, true, true, true, "EM"]);
  });

  test("a child without an id goes on holding the ids inside it: a window closing keeps its applet, whatever stands around it", async () => {
    const result = await run(`
      const board = '<div id="board"><div id="line-FXTR" data-applet="board"></div></div>';
      root.innerHTML = '<div class="cell open"><div class="cell-head">Board</div><div class="rail"></div><div class="full">' + board + '</div><div class="stack"></div></div>';
      root.querySelector('#line-FXTR')._kept = true;
      window.morph(root, '<div class="cell"><div class="cell-head">Board</div><p class="cell-summary">3 watched</p><div class="cell-body">' + board + '</div></div>');
      return [root.querySelector('#line-FXTR')._kept === true, [...root.firstChild.children].map((el) => el.className)];
    `);
    expect(result).toEqual([true, ["cell-head", "cell-summary", "cell-body"]]);
  });

  test("a list too long to compare whole is matched by place: each child of the same type kept, and drawn as it is now", async () => {
    const result = await run(`
      const items = (n) => Array.from({ length: n }, (_, i) => '<li>' + i + '</li>').join('');
      root.innerHTML = items(600);
      const second = root.children[1];
      window.morph(root, '<p>new</p>' + items(600) + '<p>end</p>'); // 602 by 600: over 250,000 pairs
      return [root.children[1] === second, root.children.length, root.children[1].textContent, root.firstChild.tagName, root.lastChild.textContent];
    `);
    expect(result).toEqual([true, 602, "0", "P", "end"]);
  });

  test("removes leftover children when the new list is shorter, and appends new ones when it is longer", async () => {
    const result = await run(`
      root.innerHTML = '<li>1</li><li>2</li><li>3</li>';
      window.morph(root, '<li>1</li>');
      const shorter = [...root.children].map((el) => el.textContent);
      window.morph(root, '<li>1</li><li>2</li>');
      return [shorter, [...root.children].map((el) => el.textContent)];
    `);
    expect(result).toEqual([["1"], ["1", "2"]]);
  });

  test("updates a text node's content in place, keyed by position", async () => {
    const result = await run(`
      root.innerHTML = 'Hello';
      const before = root.firstChild;
      window.morph(root, 'World');
      return root.firstChild === before && root.textContent === "World";
    `);
    expect(result).toBe(true);
  });

  test("an applet's children are never touched by the morph, even if the new HTML for it differs completely", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x"><span class="managed">A</span></div>';
      window.morph(root, '<div data-applet="x"><totally-different></totally-different></div>');
      return root.querySelector(".managed")?.textContent ?? null;
    `);
    expect(result).toBe("A");
  });

  test("a surviving applet fires onAppletPropsChanged, not a remount, when its data-props change, and not when they do not", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x" data-props="{&quot;a&quot;:1}"></div>';
      const before = root.firstChild;
      const seen = [];
      const hooks = { onAppletPropsChanged: (el, props) => seen.push({ same: el === before, props }) };
      window.morph(root, '<div data-applet="x" data-props="{&quot;a&quot;:1}"></div>', hooks);
      window.morph(root, '<div data-applet="x" data-props="{&quot;a&quot;:2}"></div>', hooks);
      return seen;
    `);
    expect(result).toEqual([{ same: true, props: { a: 2 } }]);
  });

  test("morphElement reconciles one element against one element's HTML: in place for the same tag, swapped otherwise, gone for none", async () => {
    const result = await run(`
      root.innerHTML = '<ul id="list"><li id="a" class="old">A</li></ul><p>keep</p>';
      const li = root.querySelector('#a');
      li._probe = true;
      window.morphElement(li, '<li id="a" class="new">A2</li>');
      const same = root.querySelector('#a')._probe === true && root.querySelector('#a').className === 'new' && root.querySelector('#a').textContent === 'A2';
      window.morphElement(root.querySelector('#a'), '<div id="a"><span data-applet="x"></span></div>');
      const swapped = root.querySelector('#list').firstChild.tagName;
      let removed = [];
      window.morphElement(root.querySelector('#a'), '<b id="a">b</b>', { onAppletRemoved: (el) => removed.push(el.dataset.applet) });
      const applet = root.querySelector('#a').tagName;
      window.morphElement(root.querySelector('#a'), '');
      return { same, swapped, removed, applet, left: root.innerHTML };
    `);
    expect(result).toEqual({ same: true, swapped: "DIV", removed: ["x"], applet: "B", left: '<ul id="list"></ul><p>keep</p>' });
  });

  test("a part inside an <svg> comes back as SVG, what is in it too, and its tag keeps an attribute's case", async () => {
    const result = await run(`
      root.innerHTML = '<svg viewBox="0 0 100 10"><defs><linearGradient data-eta-part="grad" gradientUnits="userSpaceOnUse"></linearGradient></defs><g data-eta-part="stop-1" transform="translate(10 0)"><circle cx="0" cy="5" r="3"/></g><path data-eta-part="line" d="M0 5 L10 5"/></svg>';
      const part = (key) => root.querySelector('[data-eta-part="' + key + '"]');
      window.morphElement(part("stop-1"), '<g data-eta-part="stop-1" transform="translate(20 0)"><circle cx="0" cy="5" r="4"/></g>');
      window.morphElement(part("line"), '<path data-eta-part="line" d="M0 5 L90 5"/>');
      window.morphTag(part("grad"), '<linearGradient data-eta-part="grad" gradientUnits="objectBoundingBox">');
      const [g, line, grad] = [part("stop-1"), part("line"), part("grad")];
      return {
        g: [g instanceof SVGGElement, g.firstElementChild instanceof SVGCircleElement, g.getAttribute("transform"), g instanceof SVGGElement ? g.getBBox().width : null],
        line: [line instanceof SVGPathElement, line.getAttribute("d")],
        grad: [grad.getAttributeNames(), grad.gradientUnits.baseVal === SVGUnitTypes.SVG_UNIT_TYPE_OBJECTBOUNDINGBOX],
      };
    `);
    expect(result).toEqual({ g: [true, true, "translate(20 0)", 8], line: [true, "M0 5 L90 5"], grad: [["data-eta-part", "gradientUnits"], true] });
  });

  test("an applet in the same position as a plain element (or another applet) is replaced, never reused", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x"><svg class="managed"></svg></div>';
      let removed;
      window.morph(root, '<div class="rows"><div class="row">plain</div></div>', { onAppletRemoved: (el) => { removed = el.dataset.applet; } });
      const plain = root.firstChild.outerHTML;
      root.innerHTML = '<div data-applet="x"><svg class="managed"></svg></div>';
      window.morph(root, '<div data-applet="y"></div>');
      return { plain, removed, other: root.firstChild.outerHTML };
    `);
    expect(result).toEqual({ plain: '<div class="rows"><div class="row">plain</div></div>', removed: "x", other: '<div data-applet="y"></div>' });
  });

  test("a removed applet fires onAppletRemoved before being taken out of the DOM", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x"></div><p>after</p>';
      let removed;
      window.morph(root, '<p>after</p>', { onAppletRemoved: (el) => { removed = el.dataset.applet; } });
      return { removed, remaining: root.children.length };
    `);
    expect(result).toEqual({ removed: "x", remaining: 1 });
  });

});

describe("formValue", () => {
  test("every named field keeps its key, of one type whatever it holds: a box whether it is ticked, a group of radios the value chosen or null; a form of one field, its value alone", async () => {
    const result = await run(`
      root.innerHTML = '<form><input name="title" value="Fushimi"><input type="checkbox" name="booked"><input type="checkbox" name="paid" value="yes" checked>'
        + '<input type="radio" name="kind" value="see"><input type="radio" name="kind" value="eat"><select multiple name="tags"><option selected>quiet</option><option selected>late</option></select>'
        + '<input name="gone" value="x" disabled><button name="go" value="1">Go</button></form>';
      const form = root.querySelector("form");
      const record = window.formValue(form);
      form.querySelector('[value=eat]').checked = true;
      const chosen = window.formValue(form).kind;
      root.innerHTML = '<form><input name="title" value="Fushimi"><input type="checkbox" name="booked"></form>';
      const two = window.formValue(root.querySelector("form"));
      root.innerHTML = '<form><input type="radio" name="kind" value="see"><input type="radio" name="kind" value="eat" checked></form>';
      const group = window.formValue(root.querySelector("form"));
      return { record, chosen, two, group };
    `);
    expect(result).toEqual({ record: { title: "Fushimi", booked: false, paid: true, kind: null, tags: "late" }, chosen: "eat", two: { title: "Fushimi", booked: false }, group: "eat" });
  });

  test("a form with no named fields has an undefined value", async () => {
    const result = await run(`
      root.innerHTML = '<form><button type="submit">Go</button></form>';
      return window.formValue(root.querySelector("form"));
    `);
    expect(result).toBeUndefined();
  });
});
