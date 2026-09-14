import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  await using view = new Bun.WebView();
  await view.navigate(server.url.toString());

  // The module script still needs a moment to execute after navigate() resolves.
  const start = Date.now();
  while ((await view.evaluate(`typeof window.morph`)) !== "function") {
    if (Date.now() - start > 5000) throw new Error("timed out waiting for window.morph");
    await Bun.sleep(10);
  }

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

  test("removes leftover children when the new list is shorter", async () => {
    const result = await run(`
      root.innerHTML = '<li>1</li><li>2</li><li>3</li>';
      window.morph(root, '<li>1</li>');
      return [...root.children].map((el) => el.textContent);
    `);
    expect(result).toEqual(["1"]);
  });

  test("appends new children when the new list is longer", async () => {
    const result = await run(`
      root.innerHTML = '<li>1</li>';
      window.morph(root, '<li>1</li><li>2</li>');
      return [...root.children].map((el) => el.textContent);
    `);
    expect(result).toEqual(["1", "2"]);
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

  test("a surviving applet with changed data-props fires onAppletPropsChanged, not a remount", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x" data-props="{&quot;a&quot;:1}"></div>';
      const before = root.firstChild;
      let seen;
      window.morph(root, '<div data-applet="x" data-props="{&quot;a&quot;:2}"></div>', {
        onAppletPropsChanged: (el, props) => { seen = { same: el === before, props }; },
      });
      return seen;
    `);
    expect(result).toEqual({ same: true, props: { a: 2 } });
  });

  test("an applet with unchanged data-props does not fire onAppletPropsChanged", async () => {
    const result = await run(`
      root.innerHTML = '<div data-applet="x" data-props="{&quot;a&quot;:1}"></div>';
      let fired = false;
      window.morph(root, '<div data-applet="x" data-props="{&quot;a&quot;:1}"></div>', {
        onAppletPropsChanged: () => { fired = true; },
      });
      return fired;
    `);
    expect(result).toBe(false);
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
  test("a single-field form's value is that field's raw value, unchanged", async () => {
    const result = await run(`
      root.innerHTML = '<form><input name="text" value="hello"></form>';
      return window.formValue(root.querySelector("form"));
    `);
    expect(result).toBe("hello");
  });

  test("a multi-field form's value is a record of its named fields", async () => {
    const result = await run(`
      root.innerHTML = '<form><input name="a" value="1"><input name="b" value="2"></form>';
      return window.formValue(root.querySelector("form"));
    `);
    expect(result).toEqual({ a: "1", b: "2" });
  });

  test("a form with no named fields has an undefined value", async () => {
    const result = await run(`
      root.innerHTML = '<form><button type="submit">Go</button></form>';
      return window.formValue(root.querySelector("form"));
    `);
    expect(result).toBeUndefined();
  });
});
