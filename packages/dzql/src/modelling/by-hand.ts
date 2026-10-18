// The stories by hand (docs/dzql/modelling/stories.md, "By hand"). The harness finds a story's control in the page
// the server drew, which says only that it is there: it may be hidden by a stylesheet, covered by
// something drawn over it, of no size, off a phone's screen, or a field no form sends. Here a real
// browser (`Bun.WebView`, src/webview.ts) is the author's tab: it goes where the story is done by
// pressing the controls that lead there, then does the story's write by pressing, typing into or
// choosing in the control itself, or by the gesture the story says, and what it sent is what the
// harness checks. A tap is a native click at the control's middle, once it holds still and nothing
// covers it. A drag is a mouse's pointer events, each sent to what is under it, and then the click
// a browser sends; never a script's `element.click()`. The keyboard is not pressed: the WebView's
// Enter is an editing command, not a key, so it presses no button.

import { isTest } from "../rendering/json-patch";
import type { Gesture, Post, Write } from "./stories";
import { CENTRED, MOUSE, NAMED, urlFor, waitFor } from "../rendering/webview";
import { cookieNameFor } from "../rendering/scope";

/** A phone, held upright: the stories are pressed at the size most people hold them. */
// A phone-sized tab. On Chrome (any platform but macOS, whose default is WebKit) a page left for
// about:blank may wait in the back/forward cache, its socket still open, so the server would never
// hear the tab close: the cache is off.
const PHONE: Bun.WebView.ConstructorOptions = { width: 390, height: 844, ...(process.platform === "darwin" ? {} : { backend: { type: "chrome", argv: ["--disable-features=BackForwardCache"] } }) };

/** How long a control may take to hold still and come clear, and a page to answer. */
const PATIENCE = 2000;

/** How long a page must then send nothing more, after a gesture's write has landed. */
const QUIET = 250;

/** What a press did: the writes the page sent, or why a person could not have done it -- `none` when nothing on the page could send it at all. */
type Pressed = { sent: Write[] } | { failure: string; none?: true };

/** One control the page found for a write, and how a person sends it: a press, a form's fields and its submit, or an editing form's fields; or, first, the summary that opens the `<details>` it is folded in. */
type Plan = { how: "press" | "submit" | "edit" | "open"; control: string; fields: { at: string; kind: "type" | "choose" | "tick"; text: string; none?: boolean }[]; submit?: string };

/** The same document: named whole on one side and by its type alone on the other (`room`, `room:general`) counts. */
export const sameDoc = (a: string, b: string): boolean => a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);

// The page's side, a string since it runs in the browser: the elements that send a write, as the
// kernel's client sends them (src/client/app.ts), and why a person could not press one.
const PAGE = `(() => {
  const same = ${sameDoc};
  const specOf = (el) => { try { return JSON.parse(el.dataset.write); } catch { return undefined; } };
  const named = ${NAMED};
  let marks = 0;
  const mark = (el) => { const id = String(++marks); el.setAttribute("data-hand", id); return '[data-hand="' + id + '"]'; };
  const text = (v) => (v === undefined || v === null ? "" : String(v));
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pressed = (el) => { try { return { value: el.dataset.value === undefined ? undefined : JSON.parse(el.dataset.value) }; } catch { return undefined; } };

  // why a person could not press it, or "" when they could: the browser's own rules, then the eye's
  function why(el) {
    if (el.closest("[inert]")) return "inert, behind what is open over it";
    if (el.closest("[hidden]")) return "hidden";
    if (el.matches(":disabled")) return "disabled"; // itself, or in a disabled fieldset but for its first legend
    const { r, x, y } = ${CENTRED}(el);
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return "not to be seen";
    if (r.width < 1 || r.height < 1) return "of no size";
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
      const v = pressed(el); // its data-value, JSON, as the client parses it: with its type
      if (v && sameValue(v.value, op.value)) found.push({ el, how: "press" });
    }
    return found;
  }

  function field(el, value) {
    // a select's menu and a date's picker are the system's: chosen as the browser chooses, not typed
    const kind = el.matches("select, [type=date], [type=time], [type=datetime-local], [type=month], [type=week], [type=color]") ? "choose" : el.matches("[type=checkbox], [type=radio]") ? "tick" : "type";
    const none = el.matches("select") && ![...el.options].some((o) => !o.disabled && o.value === text(value)); // a choice it does not offer
    return { at: mark(el), kind, text: text(value), none };
  }

  // how to send a form, its fields typed into and its button pressed, or why nobody can: each field
  // checked, and its button if it has one, must be pressable; why not is said of whose form it is
  function submitOf(form, checked, fields, whose) {
    const blocked = checked.map(why).find(Boolean);
    if (blocked) return { failure: "a field of " + whose + " is " + blocked };
    const button = form.querySelector("button[type=submit], button:not([type]), input[type=submit]");
    if (button && why(button)) return { failure: "the button of " + whose + " is " + why(button) };
    return { how: "submit", control: mark(form), fields, submit: button ? mark(button) : undefined };
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
      return { failure: "no one control sends all of it", none: true };
    }
    const [op] = ops;
    const found = candidates(doc, op);
    const live = found.filter((c) => c.how !== "dead");
    if (live.length === 0) return { failure: found.length ? "its field is in no form that sends it" : "nothing on the page sends it", none: true };
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
      const sent = submitOf(c.el, inputs, fields, "the form for it");
      if (sent.failure) { first = first || sent.failure; continue; }
      return sent;
    }
    return { failure: first };
  }

  // how to post a form to a route, or why nobody can: a plain form that posts there, a field each
  function posting(path, form) {
    const forms = [...document.querySelectorAll("#app form:not([data-write])")].filter((f) => f.method === "post" && f.getAttribute("action") === path);
    if (forms.length === 0) return { failure: "nothing on the page posts to " + path, none: true };
    let first = "";
    for (const f of forms) {
      const names = Object.keys(form);
      const missing = names.find((n) => !(f.elements.namedItem(n) instanceof Element));
      if (missing) { first = first || "its form has no field " + missing; continue; }
      const fields = names.map((n) => f.elements.namedItem(n));
      const sent = submitOf(f, fields, fields.map((el, i) => field(el, form[names[i]])), "its form");
      if (sent.failure) { first = first || sent.failure; continue; }
      return sent;
    }
    return { failure: first };
  }

  // what the page sends, kept to be read back, and how much of it was sent when a press last went
  // down; and a question the server answers after all it sent
  const socket = window.eta.socket();
  const send = socket.send.bind(socket);
  window.__sent = [];
  socket.send = (data) => { const m = JSON.parse(data); if (m.type !== "inspect") window.__sent.push(m); send(data); };
  window.__down = -1;
  addEventListener("pointerdown", () => { window.__down = window.__sent.length; }, true);
  const asked = () => new Promise((resolve) => {
    const on = (e) => { if (JSON.parse(e.data).type === "inspect") { socket.removeEventListener("message", on); resolve(true); } };
    socket.addEventListener("message", on);
    send(JSON.stringify({ type: "inspect" }));
  });
  const stands = () => document.querySelector("#app [data-page]")?.dataset.page;
  // a drag, as a mouse makes one (src/webview.ts): pressed at the middle of one element, moved in
  // four steps to the middle of another, let go
  function drag(from, to) {
    const a = document.querySelector(from), b = document.querySelector(to);
    const blocked = a ? why(a) : "not on the page";
    if (blocked) return "what it is dragged from is " + blocked;
    if (!b) return "where it is dragged to is not on the page";
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    const [x0, y0, x1, y1] = [r.left + r.width / 2, r.top + r.height / 2, s.left + s.width / 2, s.top + s.height / 2];
    if (x1 < 0 || y1 < 0 || x1 > innerWidth || y1 > innerHeight) return "where it is dragged to is off the screen";
    ${MOUSE}([0, 1, 2, 3, 4].map((i) => [x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4]));
    return "";
  }

  const choose = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const clear = (selector) => { const el = document.querySelector(selector); el.focus(); el.select?.(); };
  const leave = () => document.activeElement?.blur();
  // ...and a choice the page does not offer is one nobody can make
  const planned = (doc, ops) => {
    const p = plan(doc, ops);
    const unchosen = p.fields && p.fields.find((f) => f.none);
    return unchosen ? { failure: "it offers no choice of " + JSON.stringify(unchosen.text), none: true } : p;
  };
  window.__hand = { plan: planned, posting, why: (selector) => { const el = document.querySelector(selector); return el ? why(el) : "not on the page"; }, drag, asked, stands, choose, clear, leave };
  return true;
})()`;

/**
 * A browser of its own, as the author's tab: the stories put in its hand one at a time. It is
 * the same session as the harness's own socket for the author (a second tab), so what it sends is
 * theirs.
 */
export class Hand {
  view: Bun.WebView;
  private sent = 0;
  /** A form was posted: the route's cookie, which no script can take back, is this browser's now. */
  private posted = false;
  /** What the page sent by itself since it was opened: before anything was pressed, or after a gesture's write. */
  readonly strays: Write[] = [];

  constructor(private readonly url: URL, private readonly at = "") {
    this.view = new Bun.WebView(PHONE);
  }

  /** Opens the page as the session `cookie` names, standing at `place` (the URL the page mirrors); or says why it could not. */
  async enter(cookie: string, place: string | undefined): Promise<string | undefined> {
    const view = this.view;
    await view.navigate(urlFor(view, this.url, `${this.at}/api/health`));
    await view.evaluate(`document.cookie = "${cookieNameFor(this.at)}=${cookie}; path=${this.at || "/"}"`);
    await view.navigate(urlFor(view, this.url, `${this.at}/${encodeURI(place ?? "")}`));
    const drawn = place === undefined ? `document.querySelector("#app")?.children.length > 0` : `document.querySelector("#app [data-page]")?.dataset.page === ${JSON.stringify(place)}`;
    if (!(await this.until(`window.eta?.socket()?.readyState === 1 && ${drawn}`))) return `the page did not open at ${JSON.stringify(place ?? "")}`;
    await view.evaluate(PAGE);
    this.sent = 0;
    this.strays.length = 0;
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
  private until(script: string): Promise<boolean> {
    return waitFor(this.view, script, (v) => v === true, PATIENCE).then(() => true, () => false);
  }

  /** Does the write `doc`/`ops` as a person would, from whatever on the page sends it; what the page sent, once the server has answered it. */
  async press(doc: string, ops: Write["ops"]): Promise<Pressed> {
    const view = this.view;
    this.strays.push(...(await this.since()));
    const planned = () => view.evaluate<Plan | { failure: string }>(`window.__hand.plan(${JSON.stringify(doc)}, ${JSON.stringify(ops)})`);
    let plan = await planned();
    try {
      for (let folds = 0; !("failure" in plan) && plan.how === "open" && folds < 3; folds++) {
        await this.touch(plan.control); // opens it: nothing is sent
        plan = await planned();
      }
      if ("failure" in plan) return plan;
      await this.work(plan);
    } catch (err) {
      return { failure: (err as Error).message };
    }
    return this.heard(plan.how === "press" ? "pressed" : plan.how === "submit" ? "sent" : "left");
  }

  /** Fills in a plan's fields, then presses, leaves or sends it, as a person does. */
  private async work(plan: Plan): Promise<void> {
    const view = this.view;
    for (const f of plan.fields) {
      if (f.kind === "choose") await view.evaluate(`window.__hand.choose(${JSON.stringify(f.at)}, ${JSON.stringify(f.text)})`);
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
  }

  /**
   * Posts a form to a route as a person does: its fields typed into, and sent. The browser goes
   * where the route sends it; whether that is the app again (a 4xx is not), or why a person could
   * not post it -- `none` when nothing on the page posts there.
   */
  async post({ path, form }: Post): Promise<{ app: boolean } | { failure: string; none?: true }> {
    const view = this.view;
    this.strays.push(...(await this.since()));
    const plan = await view.evaluate<Plan | { failure: string; none?: true }>(`window.__hand.posting(${JSON.stringify(path)}, ${JSON.stringify(form)})`);
    if ("failure" in plan) return plan;
    try {
      this.posted = true;
      await this.work(plan);
    } catch (err) {
      return { failure: (err as Error).message };
    }
    // a page of its own: the app drawn again, with its socket open, or whatever else the route answered
    if (!(await this.until(`!window.__hand && document.readyState === "complete" && (!window.eta || (window.eta.socket()?.readyState === 1 && document.querySelector("#app")?.children.length > 0))`))) return { failure: `posted, the page did not come back from ${path}` };
    return { app: await view.evaluate<boolean>(`!!window.eta`) };
  }

  /**
   * Makes the gesture a story says, as a person would; what the page sent while it was made, from
   * the press going down to the gesture done, once the server has answered it. What the page sent
   * before the press is no gesture's but a stray; so is what it sends after (`quiet`).
   */
  async gesture(gesture: Gesture): Promise<Pressed> {
    const view = this.view;
    const how = "press" in gesture ? "pressed" : "dragged";
    await view.evaluate(`window.__down = -1`);
    const failure = "press" in gesture ? await this.touch(gesture.press).then(() => "", (err: Error) => err.message) : await view.evaluate<string>(`window.__hand.drag(${JSON.stringify(gesture.drag[0])}, ${JSON.stringify(gesture.drag[1])})`);
    if (failure) return { failure };
    const done = await view.evaluate<number>(`window.__sent.length`);
    await view.evaluate(`window.__hand.asked()`);
    const [sent, down] = await view.evaluate<[Write[], number]>(`[window.__sent, window.__down]`);
    const at = Math.max(down, this.sent);
    this.strays.push(...sent.slice(this.sent, at));
    const made = sent.slice(at, done);
    this.sent = done;
    return made.length > 0 ? { sent: made } : { failure: `the page sent nothing when it was ${how}` };
  }

  /** Waits the while a page should then be still, and keeps what it sent meanwhile as strays: nothing, from a page that writes once. */
  async quiet(): Promise<void> {
    await Bun.sleep(QUIET);
    this.strays.push(...(await this.since()));
  }

  /** What the page sent since the last it was asked, once the server has answered it: at once for a press, after a pause for a field typed into. */
  private async heard(how: string): Promise<Pressed> {
    if (!(await this.until(`window.__sent.length > ${this.sent}`))) return { failure: `the page sent nothing when it was ${how}` };
    await this.view.evaluate(`window.__hand.asked()`);
    return { sent: await this.since() };
  }

  /** What the page sent since it was last read. */
  private async since(): Promise<Write[]> {
    const sent = await this.view.evaluate<Write[]>(`window.__sent`);
    const now = sent.slice(this.sent);
    this.sent = sent.length;
    return now;
  }

  /** A tap on what `selector` names, once it holds still and nothing covers it. */
  private async touch(selector: string): Promise<void> {
    const clicked = await this.view.click(selector, { timeout: PATIENCE }).then(() => true, () => false);
    if (!clicked) throw new Error(`the control for it is ${(await this.view.evaluate<string>(`window.__hand.why(${JSON.stringify(selector)})`)) || "never still"}`);
  }

  /** Closes the tab: the page goes, and its socket with it. After a post, the browser goes too: the next story's is a fresh one, not signed in by the route's cookie. */
  async leave(): Promise<void> {
    await this.view.navigate("about:blank");
    if (!this.posted) return;
    this.view.close();
    this.view = new Bun.WebView(PHONE);
    this.posted = false;
  }

  close(): void {
    this.view.close();
  }
}

/** A write in words: each op, its path and its value, and the document. */
export const worded = (w: Write): string => `${w.ops.map((op) => `${op.op} ${op.path}${op.value === undefined ? "" : ` ${JSON.stringify(op.value)}`}`).join(", ")} on ${w.doc}`;

/**
 * Does `sent` say what `story` writes? A value compares with its type, as the wire carries it (a
 * button's `true` is not "true", a number field's 2 is not "2"); a record by its keys: the story's,
 * and no other but one a form sent blank (a field left empty: "" or null). A `test` is no write,
 * and the page's own: the two are compared by their verbs.
 */
export function sameWrite(sent: Write, story: Write): boolean {
  const blank = (v: unknown): boolean => v === "" || v === null || v === undefined;
  const same = (a: unknown, b: unknown): boolean =>
    a !== null && b !== null && typeof a === "object" && typeof b === "object"
      ? Object.keys(b).every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) && Object.keys(a).every((k) => k in b || blank((a as Record<string, unknown>)[k]))
      : a === b;
  const [ours, theirs] = [sent, story].map((w) => w.ops.filter((op) => !isTest(op))) as [Write["ops"], Write["ops"]];
  return sameDoc(sent.doc, story.doc) && ours.length === theirs.length && ours.every((op, i) => op.op === theirs[i]!.op && op.path === theirs[i]!.path && same(op.value, theirs[i]!.value));
}
