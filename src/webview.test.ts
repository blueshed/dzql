import { describe, expect, test } from "bun:test";
import { press, urlFor } from "./webview";

// Both platforms' paths, on whichever this runs: a browser test only ever takes its own.
describe("at: a view's own address", () => {
  const view = (): Bun.WebView => ({}) as Bun.WebView; // only its identity is used
  const url = "http://localhost:4321";

  test("on macOS (WebKit) views are apart already: the address as it is", () => {
    expect(urlFor(view(), url, "/room", "darwin")).toBe("http://localhost:4321/room");
  });

  test("elsewhere (Chrome) each view gets a host of its own, and keeps it", () => {
    const [a, b] = [view(), view()];
    const first = urlFor(a, url, "/room", "linux");
    expect(first).toMatch(/^http:\/\/view\d+\.localhost:4321\/room$/);
    expect(urlFor(a, url, "/other", "linux")).toBe(first.replace("/room", "/other")); // the same host again
    expect(new URL(urlFor(b, url, "", "linux")).hostname).not.toBe(new URL(first).hostname);
  });
});

describe("press: as a mouse does, never element.click()", () => {
  /** A page of `html`, noting each press event as it reaches something: its type and what it reached. */
  async function page(html: string): Promise<Bun.WebView> {
    const view = new Bun.WebView({ width: 400, height: 400 });
    await view.navigate("about:blank");
    await view.evaluate(`(document.body.innerHTML = ${JSON.stringify(html)}, window.heard = [], ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) => document.addEventListener(t, (e) => heard.push(t + " " + e.target.id), true)), 1)`);
    return view;
  }

  test("scrolled into view, it is pressed and let go at its middle, each event to what is there, then the click", async () => {
    await using view = await page(`<div style="height: 2000px"></div><button id="far"><span id="word">far</span></button>`);
    await press(view, "#far");
    expect(await view.evaluate<string[]>(`heard`)).toEqual(["pointerdown word", "mousedown word", "pointerup word", "mouseup word", "click word"]);
  });

  test("a page that redraws what was pressed as it is let go is sent no click, as a browser sends none (japan-eta's strip on the desktop)", async () => {
    await using view = await page(`<div id="strip"><a id="stop" href="#">Nara</a></div>`);
    await view.evaluate(`(document.getElementById("stop").addEventListener("pointerup", (e) => (e.target.outerHTML = '<a id="stop" href="#">Nara</a>')), 1)`);
    await press(view, "#stop");
    expect(await view.evaluate<string[]>(`heard`)).toEqual(["pointerdown stop", "mousedown stop", "pointerup stop"]); // its mouseup went to the link taken out; no click
  });

  test("what is covered, or not there, cannot be pressed, and it says why", async () => {
    await using view = await page(`<button id="under">under</button><div class="scrim" style="position: fixed; inset: 0"></div>`);
    await expect(press(view, "#under", 100)).rejects.toThrow("cannot press #under: at its middle is div.scrim");
    await expect(press(view, "#nowhere", 100)).rejects.toThrow("cannot press #nowhere: it is not on the page");
    await expect(press(view, "#[", 100)).rejects.toThrow("cannot press #[: "); // no selector at all: the page's own error
    expect(await view.evaluate<string[]>(`heard`)).toEqual([]);
  });

  test("what is disabled cannot be pressed, itself, by what is in it, or in a disabled fieldset, and it says so", async () => {
    await using view = await page(`<button id="off" disabled><span id="inside">off</span></button><fieldset disabled><button id="held">held</button></fieldset>`);
    for (const selector of ["#off", "#inside", "#held"]) await expect(press(view, selector, 100)).rejects.toThrow(`cannot press ${selector}: it is disabled`);
    expect(await view.evaluate<string[]>(`heard`)).toEqual([]);
  });
});
