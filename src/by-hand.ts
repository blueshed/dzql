// The stories by hand (stories.md, "By hand"). The harness finds a story's control in the page
// the server drew, which says only that it is there: it may be hidden by a stylesheet, covered by
// something drawn over it, of no size, off a phone's screen, or a field no form sends. Here a real
// browser (`Bun.WebView`, src/webview.ts) is the author's tab: it goes where the story is done by
// pressing the controls that lead there, then does the story's write by pressing, typing into or
// choosing in the control itself, or by the gesture the story says, and what it sent is what the
// harness checks. A tap is a native click at the control's middle, once it holds still and nothing
// covers it. A drag is a mouse's pointer events, each sent to what is under it, and then the click
// a browser sends; never a script's `element.click()`. The keyboard is not pressed: the WebView's
// Enter is an editing command, not a key, so it presses no button.

import type { PatchOp } from "./json-patch";
import type { Gesture, Write } from "./stories";
import { urlFor } from "./webview";

/** A phone, held upright: the stories are pressed at the size most people hold them. */
export const PHONE = { width: 390, height: 844 };

/** How long a control may take to hold still and come clear, and a page to answer. */
const PATIENCE = 2000;

/** What a press did: the writes the page sent, or why a person could not have done it. */
export type Pressed = { sent: Write[] } | { failure: string };

/** One control the page found for a write, and how a person sends it: a press, a form's fields and its submit, or an editing form's fields; or, first, the summary that opens the `<details>` it is folded in. */
type Plan = { how: "press" | "submit" | "edit" | "open"; control: string; fields: { at: string; kind: "type" | "choose" | "tick"; text: string }[]; submit?: string };

// The page's side, a string since it runs in the browser: the elements that send a write, as the
// kernel's client sends them (src/client/app.ts), and why a person could not press one.
const PAGE = `(() => {
  const same = (a, b) => a === b || a.startsWith(b + ":") || b.startsWith(a + ":");
  const specOf = (el) => { try { return JSON.parse(el.dataset.write); } catch { return undefined; } };
  const named = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].map((c) => "." + c).join("");
  let marks = 0;
  const mark = (el) => { const id = String(++marks); el.setAttribute("data-hand", id); return '[data-hand="' + id + '"]'; };
  const text = (v) => (v === undefined || v === null ? "" : String(v));

  // why a person could not press it, or "" when they could: the browser's own rules, then the eye's
  function why(el) {
    if (el.closest("[inert]")) return "inert, behind what is open over it";
    if (el.closest("[hidden]")) return "hidden";
    if (el.disabled || el.closest("fieldset[disabled]")) return "disabled";
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return "not to be seen";
    if (r.width < 1 || r.height < 1) return "of no size";
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "off the screen";
    const top = document.elementFromPoint(x, y);
    if (!top || (top !== el && !el.contains(top) && !(el.labels && [...el.labels].some((l) => l.contains(top))))) return "covered by " + (top ? named(top) : "nothing");
    return "";
  }

  // the controls that send one op, as the client sends them: a button its own value, a form what is typed, an editing form's field its own
  function candidates(doc, op) {
    const found = [];
    for (const el of document.querySelectorAll("#app [data-write]")) {
      const s = specOf(el);
      if (!s || !same(s.doc, doc) || s.op !== op.op || s.path !== op.path) continue;
      if (el.matches("form")) { if (!el.dataset.writeOn) found.push({ el, how: "submit" }); continue; }
      if (el.matches("input, textarea, select")) { found.push({ el, how: el.closest("form[data-write-on]") ? "edit" : "dead" }); continue; }
      const v = el.dataset.value;
      if (op.value === undefined ? v === undefined : v === text(op.value)) found.push({ el, how: "press" });
    }
    return found;
  }

  function field(el, value) {
    const kind = el.matches("select") ? "choose" : el.matches("[type=checkbox], [type=radio]") ? "tick" : "type";
    return { at: mark(el), kind, text: text(value) };
  }

  // how to send this write from the page, or why nobody can: one control for every op of it
  function plan(doc, ops) {
    if (ops.length > 1) {
      // several ops in one message: only an editing form sends more than one, a field each
      const forms = new Set(ops.flatMap((op) => candidates(doc, op).filter((c) => c.how === "edit").map((c) => c.el.closest("form"))));
      for (const form of forms) {
        const fields = ops.map((op) => candidates(doc, op).find((c) => c.how === "edit" && c.el.closest("form") === form));
        if (fields.every(Boolean)) {
          const blocked = fields.map((c) => why(c.el)).find(Boolean);
          if (blocked) return { failure: "the form for it is " + blocked };
          return { how: "edit", control: mark(form), fields: fields.map((c, i) => field(c.el, ops[i].value)) };
        }
      }
      return { failure: "no one control sends all of it" };
    }
    const [op] = ops;
    const found = candidates(doc, op);
    const live = found.filter((c) => c.how !== "dead");
    if (live.length === 0) return { failure: found.length ? "its field is in no form that sends it" : "nothing on the page sends it" };
    let first = "";
    for (const c of live) {
      // folded away in a <details>: its summary is pressed first, as a person opens it
      const shut = c.el.closest("details:not([open])");
      const summary = shut && shut.querySelector(":scope > summary");
      if (summary && !summary.contains(c.el) && !why(summary)) return { how: "open", control: mark(summary), fields: [] };
      const blocked = why(c.el);
      if (blocked) { first = first || "the control for it is " + blocked; continue; }
      if (c.how === "press") return { how: "press", control: mark(c.el), fields: [] };
      if (c.how === "edit") return { how: "edit", control: mark(c.el), fields: [field(c.el, op.value)] };
      // a form that creates: its value is its one field's, or a record by name of its several
      const inputs = [...c.el.elements].filter((f) => f.matches("input:not([type=submit]):not([type=button]), textarea, select"));
      const fields = inputs.length === 1 ? [field(inputs[0], op.value)] : inputs.filter((f) => op.value && typeof op.value === "object" && f.name in op.value).map((f) => field(f, op.value[f.name]));
      const blockedField = inputs.map(why).find(Boolean);
      if (blockedField) { first = first || "a field of the form for it is " + blockedField; continue; }
      const button = c.el.querySelector("button[type=submit], button:not([type]), input[type=submit]");
      if (button && why(button)) { first = first || "the button of the form for it is " + why(button); continue; }
      return { how: "submit", control: mark(c.el), fields, submit: button ? mark(button) : undefined };
    }
    return { failure: first };
  }

  // what the page sends, kept to be read back; and a question the server answers after all it sent
  const socket = window.eta.socket();
  const send = socket.send.bind(socket);
  window.__sent = [];
  socket.send = (data) => { const m = JSON.parse(data); if (m.type !== "inspect") window.__sent.push(m); send(data); };
  const asked = () => new Promise((resolve) => {
    const on = (e) => { if (JSON.parse(e.data).type === "inspect") { socket.removeEventListener("message", on); resolve(true); } };
    socket.addEventListener("message", on);
    send(JSON.stringify({ type: "inspect" }));
  });
  const stands = () => document.querySelector("#app [data-page]")?.dataset.page;
  // a drag, as a mouse makes one: pressed at the middle of one element, moved to the middle of
  // another, let go; each pointer event sent to what is under it (a mouse event after it, unless
  // the press was cancelled), then the click, to what the press and the release share
  function drag(from, to) {
    const a = document.querySelector(from), b = document.querySelector(to);
    const blocked = a ? why(a) : "not on the page";
    if (blocked) return "what it is dragged from is " + blocked;
    if (!b) return "where it is dragged to is not on the page";
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    const [x0, y0, x1, y1] = [r.left + r.width / 2, r.top + r.height / 2, s.left + s.width / 2, s.top + s.height / 2];
    if (x1 < 0 || y1 < 0 || x1 > innerWidth || y1 > innerHeight) return "where it is dragged to is off the screen";
    let mice = true;
    const at = (type, x, y, button, buttons) => {
      const el = document.elementFromPoint(x, y);
      const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const sent = el.dispatchEvent(new PointerEvent("pointer" + type, init));
      if (type === "down") mice = sent;
      if (mice) el.dispatchEvent(new MouseEvent("mouse" + type, init));
      return el;
    };
    const down = at("down", x0, y0, 0, 1);
    for (let i = 1; i <= 4; i++) at("move", x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4, -1, 1);
    const up = at("up", x1, y1, 0, 0);
    let shared = down;
    while (shared && !shared.contains(up)) shared = shared.parentElement;
    if (shared && shared.isConnected) shared.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, clientX: x1, clientY: y1 }));
    return "";
  }

  const choose = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const clear = (selector) => { const el = document.querySelector(selector); el.focus(); el.select?.(); };
  const leave = () => document.activeElement?.blur();
  window.__hand = { plan, why: (selector) => { const el = document.querySelector(selector); return el ? why(el) : "not on the page"; }, drag, asked, stands, choose, clear, leave };
  return true;
})()`;

/**
 * A browser of its own, as the author's tab: the stories put in its hand one at a time. It is
 * the same session as the harness's own socket for the author (a second tab), so what it sends is
 * theirs.
 */
export class Hand {
  readonly view: Bun.WebView;
  private sent = 0;

  constructor(private readonly url: URL) {
    this.view = new Bun.WebView(PHONE);
  }

  /** Opens the page as `sessionId`, standing at `place` (the URL the page mirrors); or says why it could not. */
  async enter(sessionId: string, place: string | undefined): Promise<string | undefined> {
    const view = this.view;
    await view.navigate(urlFor(view, this.url, "/api/health"));
    await view.evaluate(`document.cookie = "session_id=${sessionId}; path=/"`);
    await view.navigate(urlFor(view, this.url, `/${encodeURI(place ?? "")}`));
    const drawn = place === undefined ? `document.querySelector("#app")?.children.length > 0` : `document.querySelector("#app [data-page]")?.dataset.page === ${JSON.stringify(place)}`;
    if (!(await this.until(`window.eta?.socket()?.readyState === 1 && ${drawn}`))) return `the page did not open at ${JSON.stringify(place ?? "")}`;
    await view.evaluate(PAGE);
    this.sent = 0;
    return undefined;
  }

  /** Where the page says it stands. */
  async here(): Promise<string | undefined> {
    return (await this.view.evaluate<string | undefined>(`window.__hand.stands()`)) ?? undefined;
  }

  /** Where the page says it stands, once it says `place` or has had its time to. */
  async standsAt(place: string): Promise<string | undefined> {
    await this.until(`window.__hand.stands() === ${JSON.stringify(place)}`);
    return this.here();
  }

  /** Whether `script` comes true in the page within its time: a page answers by drawing, which nothing else says it has done. */
  private async until(script: string): Promise<boolean> {
    for (const end = performance.now() + PATIENCE; ; await Bun.sleep(20)) if ((await this.view.evaluate(script)) === true || performance.now() > end) return (await this.view.evaluate(script)) === true;
  }

  /** Does the write `doc`/`ops` as a person would, from whatever on the page sends it; what the page sent, once the server has answered it. */
  async press(doc: string, ops: PatchOp[]): Promise<Pressed> {
    const view = this.view;
    const planned = () => view.evaluate<Plan | { failure: string }>(`window.__hand.plan(${JSON.stringify(doc)}, ${JSON.stringify(ops)})`);
    let plan = await planned();
    try {
      for (let folds = 0; !("failure" in plan) && plan.how === "open" && folds < 3; folds++) {
        await this.touch(plan.control); // opens it: nothing is sent
        plan = await planned();
      }
      if ("failure" in plan) return plan;
      for (const f of plan.fields) {
        if (f.kind === "choose") await view.evaluate(`window.__hand.choose(${JSON.stringify(f.at)}, ${JSON.stringify(f.text)})`); // a select's menu is the system's: chosen as the browser chooses
        else if (f.kind === "tick") await this.touch(f.at);
        else {
          await this.touch(f.at);
          await view.evaluate(`window.__hand.clear(${JSON.stringify(f.at)})`);
          if (f.text === "") await view.press("Backspace");
          else await view.type(f.text);
        }
      }
      if (plan.how === "press") await this.touch(plan.control);
      else if (plan.how === "edit") await view.evaluate(`window.__hand.leave()`); // leaving the field sends it
      else if (plan.submit) await this.touch(plan.submit);
      else await view.press("Enter"); // the caret is in the form: Enter sends it, as a phone's Go does
    } catch (err) {
      return { failure: (err as Error).message };
    }
    return this.heard(plan.how === "press" ? "pressed" : plan.how === "submit" ? "sent" : "left");
  }

  /** Makes the gesture a story says, as a person would; what the page sent, once the server has answered it. */
  async gesture(gesture: Gesture): Promise<Pressed> {
    if ("press" in gesture) {
      const failure = await this.touch(gesture.press).then(() => undefined, (err: Error) => err.message);
      return failure ? { failure } : this.heard("pressed");
    }
    const failure = await this.view.evaluate<string>(`window.__hand.drag(${JSON.stringify(gesture.drag[0])}, ${JSON.stringify(gesture.drag[1])})`);
    return failure ? { failure } : this.heard("dragged");
  }

  /** What the page sent since the last it was asked, once the server has answered it: at once for a press, after a pause for a field typed into. */
  private async heard(how: string): Promise<Pressed> {
    if (!(await this.until(`window.__sent.length > ${this.sent}`))) return { failure: `the page sent nothing when it was ${how}` };
    await this.view.evaluate(`window.__hand.asked()`);
    const sent = await this.view.evaluate<Write[]>(`window.__sent`);
    const now = sent.slice(this.sent);
    this.sent = sent.length;
    return { sent: now };
  }

  /** A tap on what `selector` names, once it holds still and nothing covers it. */
  private async touch(selector: string): Promise<void> {
    const clicked = await this.view.click(selector, { timeout: PATIENCE }).then(() => true, () => false);
    if (!clicked) throw new Error(`the control for it is ${(await this.view.evaluate<string>(`window.__hand.why(${JSON.stringify(selector)})`)) || "never still"}`);
  }

  /** Closes the tab: the page goes, and its socket with it. */
  async leave(): Promise<void> {
    await this.view.navigate("about:blank");
  }

  close(): void {
    this.view.close();
  }
}

/** Does `sent` say what `story` writes? A value from a page is a string, so a value compares as the wire sends a button's (`String`), a record by its keys. */
export function sameWrite(sent: Write, story: Write): boolean {
  const same = (a: unknown, b: unknown): boolean =>
    a !== null && b !== null && typeof a === "object" && typeof b === "object"
      ? Object.keys(b).every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      : String(a ?? "") === String(b ?? "");
  const doc = (a: string, b: string) => a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
  return doc(sent.doc, story.doc) && sent.ops.length === story.ops.length && sent.ops.every((op, i) => op.op === story.ops[i]!.op && op.path === story.ops[i]!.path && same(op.value, story.ops[i]!.value));
}
