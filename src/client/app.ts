import { applets } from "../applets";
import type { PatchOp } from "../json-patch";
import { formValue, groupOf, held, type Field } from "./form-value";
import type { HtmlOp } from "../compartments/render";
import { drawnOption, keepingChoices, morph, morphElement, morphTag, removeNode } from "./morph";

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_OPS_KEPT_PER_DOC = 5;

const app = document.querySelector<HTMLElement>("#app")!;
let socket: WebSocket | undefined;

// What the client has seen of each document's writes: not domain state, just
// an echo log, so a person at the console can read the session back.
const docs = new Map<string, { version: number; ops: PatchOp[] }>();

function recordPatch(doc: string, version: number, ops: PatchOp[]) {
  const state = docs.get(doc) ?? { version: 0, ops: [] };
  state.version = version;
  state.ops = [...state.ops, ...ops].slice(-MAX_OPS_KEPT_PER_DOC);
  docs.set(doc, state);
}

// The last write this client sent and whether the server echoed it back --
// not domain state, just enough to answer "did that even go through" from
// the console.
let lastSent: { doc: string; ops: PatchOp[]; echoed: boolean } | undefined;

declare global {
  interface Window {
    eta?: {
      docs(): Record<string, { version: number; ops: PatchOp[] }>;
      reconnectDelay(): number;
      socket(): WebSocket | undefined;
      inspect(): { docs: Record<string, { version: number; ops: PatchOp[] }>; lastSent: typeof lastSent };
    };
  }
}

let reconnectDelay = RECONNECT_DELAY_MS;
window.eta = {
  docs: () => Object.fromEntries(docs),
  reconnectDelay: () => reconnectDelay,
  socket: () => socket,
  inspect: () => ({ docs: Object.fromEntries(docs), lastSent }),
};

const mounted = new Map<HTMLElement, () => void>();

function mountApplets() {
  app.querySelectorAll<HTMLElement>("[data-applet]").forEach((el) => {
    if (mounted.has(el)) return;
    const applet = applets[el.dataset.applet!];
    if (!applet) return;
    const props = el.dataset.props ? JSON.parse(el.dataset.props) : undefined;
    const cleanup = applet.mount(el, { props, send });
    mounted.set(el, cleanup ?? (() => {}));
  });
}

function onAppletRemoved(el: Element) {
  mounted.get(el as HTMLElement)?.();
  mounted.delete(el as HTMLElement);
}

function onAppletPropsChanged(el: Element, props: unknown) {
  applets[(el as HTMLElement).dataset.applet!]?.update?.(el as HTMLElement, props);
}

// A render morphs the existing tree instead of replacing it, so an element a
// person is focused on, typing into, or has scrolled survives a render that
// doesn't concern it -- see morph.ts. [data-applet] elements are a boundary
// the morph never descends into (see onAppletRemoved/onAppletPropsChanged);
// mounting a newly-appeared one still happens here, same as before.
// A box someone is pressing is theirs until the click lands (`pressed`): a render drawn between the
// press and the click must not tick it first, or the click unticks it, and sends that, undoing
// whoever ticked it. Pressing its label is pressing it.
let pressed: Element | undefined;
app.addEventListener("pointerdown", (event) => {
  const at = event.target instanceof Element ? event.target : null;
  const box = at?.closest("label")?.control ?? at;
  pressed = box instanceof HTMLInputElement && box.type === "checkbox" ? box : undefined;
});
document.addEventListener("click", () => (pressed = undefined), true); // a click lands after its tick
app.addEventListener("pointercancel", () => (pressed = undefined));
const hooks = { onAppletRemoved, onAppletPropsChanged, pressed: (el: Element) => el === pressed };

// Where a tab is (change-request.md item 3): an example may mark some element within #app with
// `data-page` (the session's own idea of the page) and `data-page-write` (the write that sets
// it) -- the kernel knows nothing about what a "page" means, only that this pair, when present,
// should be mirrored into the URL so the back button and a shared link work. `knownPage` is
// undefined until the first full render, which is also the only time the URL might already
// disagree with the session (a shared link, a reload): then the session is caught up to the URL
// instead of the other way round, since the URL is what the person actually asked for.
let knownPage: string | undefined;
let pageWrite: WriteSpec | undefined;

/** The page the URL names: its path and, after a `?`, the one thing open over it (src/bento.ts's address). */
const pageInUrl = (): string => decodeURI(location.pathname.slice(1) + location.search);

function syncPage() {
  const el = app.querySelector<HTMLElement>("[data-page]");
  if (!el) return;
  const page = el.dataset.page!;
  if (el.dataset.pageWrite) pageWrite = JSON.parse(el.dataset.pageWrite) as WriteSpec;

  if (knownPage === undefined) {
    const urlPage = pageInUrl();
    if (urlPage !== page && pageWrite) {
      knownPage = urlPage; // the URL already says this; nothing to push once the session catches up
      send(pageWrite.doc, [{ op: pageWrite.op, path: pageWrite.path, value: urlPage }]);
    } else {
      knownPage = page;
      history.replaceState({ page }, "", "/" + encodeURI(page));
    }
    return;
  }
  if (page !== knownPage) {
    knownPage = page;
    history.pushState({ page }, "", "/" + encodeURI(page));
  }
}

window.addEventListener("popstate", () => {
  const page = pageInUrl();
  knownPage = page;
  if (pageWrite) send(pageWrite.doc, [{ op: pageWrite.op, path: pageWrite.path, value: page }]);
});

// Rule 7 of bento-request.md's K1: a render may mark one element `data-moving="<name>"`. When
// the page as it is and the page as rendered both carry an element with the same value, that
// element -- and only that one -- grows into the window instead of the page going anywhere.
// `movingElement` parses the incoming HTML (a `<template>`, same technique `applyFragments` uses
// below) to find out whether the render still has it, without touching the live DOM yet.
//
// A box with more than one openable cell (W3) marks every one of them `data-moving` at
// once -- each is a candidate for the next thing to grow, and the render can't know in advance
// which -- so the page as it is may carry several. Only one of them is actually transitioning:
// the one whose matching element in the render differs from what's on screen now (a still-closed
// sibling's markup is byte-for-byte the same before and after, since nothing about it changed).
function movingElement(html: string): HTMLElement | undefined {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  for (const current of app.querySelectorAll<HTMLElement>("[data-moving]")) {
    const stillThere = holder.content.querySelector(`[data-moving="${CSS.escape(current.dataset.moving!)}"]`);
    // A move is the element itself changing -- a cell opening into the window, or closing --
    // which shows in its own tag. What is inside it changing (a row more, a message) is not one,
    // and a transition then would swallow the keys of someone typing in it.
    if (stillThere && (stillThere.cloneNode(false) as Element).outerHTML !== (current.cloneNode(false) as Element).outerHTML) return current;
  }
  return undefined;
}

// Rule 18 of bento-request.md's K2: after a full render's morph, an element newly carrying
// `data-reveal` (or carrying it for the first time on a different element than before) scrolls
// into view -- the window itself never moves, only the reading beside it. `previous` is captured
// before the morph runs, since the morph is what may add, move, or remove the attribute. It comes
// by its nearest edge, unless it and its margins cannot fit in the view: then by its top, where it
// is read from, since reached from below its nearest edge is its foot, and its top lands out of
// sight. Only the scroller that holds it moves then: `scrollIntoView` would move every one around it.
function revealChanged(previous: Element | null): void {
  const current = app.querySelector<HTMLElement>("[data-reveal]");
  if (!current || current === previous) return;
  const port = scrollerOf(current);
  const { scrollMarginTop, scrollMarginBottom } = getComputedStyle(current);
  const { scrollPaddingTop, scrollPaddingBottom } = getComputedStyle(port);
  const [marginTop, paddingTop] = [parseFloat(scrollMarginTop), lengthIn(scrollPaddingTop, port.clientHeight)];
  const view = port.clientHeight - paddingTop - lengthIn(scrollPaddingBottom, port.clientHeight);
  const box = current.getBoundingClientRect();
  if (box.height + marginTop + parseFloat(scrollMarginBottom) <= view) return current.scrollIntoView({ block: "nearest", inline: "nearest" });
  const top = port === document.documentElement ? 0 : port.getBoundingClientRect().top + port.clientTop;
  port.scrollBy({ top: box.top - top - paddingTop - marginTop });
}

/** The scroller `el` is read in: its nearest ancestor that scrolls, or the page. */
function scrollerOf(el: Element): Element {
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    if (at.scrollHeight > at.clientHeight && /auto|scroll|hidden/.test(getComputedStyle(at).overflowY)) return at;
  }
  return document.documentElement;
}

/** A computed `scroll-padding` in px: a percentage is of the scroller's own height, and `auto` is none. */
const lengthIn = (value: string, height: number): number => (value.endsWith("%") ? (parseFloat(value) * height) / 100 : parseFloat(value) || 0);

function render(html: string) {
  const before = new Map([...app.querySelectorAll<HTMLElement>("[data-autoscroll]")].map((el) => [el, el.childNodes.length]));
  const previousReveal = app.querySelector<HTMLElement>("[data-reveal]");
  const moving = movingElement(html);

  const apply = () => {
    morph(app, html, hooks);
    settle(before);
    syncPage();
    revealChanged(previousReveal);
  };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (moving && !reduced && "startViewTransition" in document) {
    moving.style.viewTransitionName = "moving";
    // `finished` rejects when the transition is skipped -- another render arrived before it settled,
    // or the page is hidden -- which is routine, not an error: the morph still ran, only the animation did not
    const transition = document.startViewTransition(apply);
    transition.ready.catch(() => {});
    transition.finished
      .catch(() => {})
      .finally(() => {
        moving.style.viewTransitionName = "";
      });
  } else {
    apply();
  }
}

// The page in parts: what changed since the last drawing, in HTML's terms (src/parts.ts). Each op
// names a part; a target the page no longer has is skipped -- the next full render puts things
// right, as it would after a reconnect. The ops keep a choice not yet drawn as one render does,
// since a group of radios may span parts. Afterwards, the same care as a whole render.
function applyFragments(ops: HtmlOp[]) {
  const before = new Map([...app.querySelectorAll<HTMLElement>("[data-autoscroll]")].map((el) => [el, el.childNodes.length]));
  const previousReveal = app.querySelector<HTMLElement>("[data-reveal]");

  keepingChoices(() => {
    for (const op of ops) {
      const target = app.querySelector(op.target);
      // what is inside an applet is the applet's, as it is to the morph: its own element may be a part, nothing in it
      if (!target || target.parentElement?.closest("[data-applet]")) continue;
      if (op.op === "replace") {
        morphElement(target, op.html, hooks);
      } else if (op.op === "tag") {
        morphTag(target, op.html, hooks);
      } else if (op.op === "remove") {
        removeNode(target, hooks);
      } else {
        target.insertAdjacentHTML(op.op === "after" ? "afterend" : "beforebegin", op.html);
      }
    }
  });
  settle(before);
  syncPage();
  revealChanged(previousReveal);
}

// After any render, full or fragment: mount what appeared, give the caret to a field that is
// waiting for it, and pin what grew. A browser honours `autofocus` once per document, so a field
// a later render brings in would otherwise wait for a click. Only when nothing has the caret --
// the row that was tapped is gone, the form that was submitted is gone -- never from a field
// someone is in.
function settle(before: Map<HTMLElement, number>) {
  mountApplets();
  if (document.activeElement === document.body) app.querySelector<HTMLElement>("[autofocus]")?.focus();

  // Pin to the bottom only when this render actually added content here, or
  // the element itself just appeared (a fresh load, entering a room) -- an
  // unrelated update (someone else's presence, an undo elsewhere) must not
  // yank the scroll position out from under someone reading history.
  for (const el of app.querySelectorAll<HTMLElement>("[data-autoscroll]")) {
    const was = before.get(el);
    if (was === undefined || el.childNodes.length > was) el.scrollTop = el.scrollHeight;
  }
}

type WriteSpec = { doc: string; op: PatchOp["op"]; path: string };

/** Is `echoed` the document a write named? The echo names it whole (`room:general`); a write may
 * name it so, or by its type alone (`room`), meaning the one of that type this page is on. */
const isNamed = (named: string, echoed: string): boolean => echoed === named || echoed.startsWith(`${named}:`);

function send(doc: string, ops: PatchOp[]) {
  lastSent = { doc, ops, echoed: false };
  socket?.send(JSON.stringify({ doc, ops }));
}

/** A field (form-value.ts) an editing form sends and a refusal hands back. A `multiple` select holds several values where a
 * write carries one, so it is not one here: an editing form never sends it, and a refusal does not hand it back. */
const isField = (el: Element): el is Field =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLSelectElement && !el.multiple);

const isBox = (field: Field): field is HTMLInputElement & { type: "checkbox" } => field instanceof HTMLInputElement && field.type === "checkbox";
const isRadio = (field: Field): field is HTMLInputElement & { type: "radio" } => field instanceof HTMLInputElement && field.type === "radio";

/** Puts back what a field held: a box's tick, a group's choice (by its value; none for null), or a value. */
function hold(field: Field, value: string | boolean | null): void {
  if (isBox(field)) field.checked = value as boolean;
  else if (isRadio(field)) for (const r of groupOf(field)) r.checked = r.value === value;
  else field.value = value as string;
}

// A form clears as it sends, and a refused write hands back what was sent: a refusal is answered
// with the page whole, before any echo of the form's document. So what someone types while the
// write is on its way is theirs -- no echo, anyone's, clears it -- and a refusal never eats text.
let sending: { doc: string; sent: [Field, string | boolean | null][] } | undefined;

// An element says what it writes via data-write; a form's field is the
// value (or a record of its fields, if it has more than one), a button/li's
// data-value is the value, nothing else goes up.
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const spec = form.dataset.write;
  if (!spec) return; // not a write: a plain form posts as the browser does (a sign-in)
  event.preventDefault();
  const { doc, op, path } = JSON.parse(spec) as WriteSpec;
  const fields = [...form.elements].filter(isField);
  sending = { doc, sent: fields.map((f) => [f, held(f)]) };
  send(doc, [{ op, path, value: formValue(form) }]);
  form.reset();
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-write]");
  // A form writes on submit, and a field's data-write names its path for an editing form (below):
  // neither is a gesture. Putting the caret in find's field must not send a blank replace.
  if (!target || target.matches("form, input, textarea, select")) return;
  event.preventDefault();
  const { doc, op, path } = JSON.parse(target.dataset.write!) as WriteSpec;
  const value = target.dataset.value;
  send(doc, value !== undefined ? [{ op, path, value }] : [{ op, path }]);
});

// Escape puts away what was opened last: it presses the last `[data-escape]` on the page -- a
// modal's scrim is drawn after the drawer it may open over -- as a click would, so it sends that
// control's own write and nothing the page did not offer.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const away = [...app.querySelectorAll<HTMLElement>("[data-escape]")].at(-1);
  if (!away) return;
  event.preventDefault();
  away.click();
});

// A `data-write-on="blur"|"change"|"input"` form is an editing one, not a creating one:
// `data-write` lives on its *fields*, each naming its own path, and the form commits on that
// trigger instead of a submit -- one op per field whose live value has diverged from what the
// last render put in its `value` attribute (not a dirty flag; the morph keeps that attribute
// current, so a field an unrelated render touched doesn't look changed just because it exists).
// No reset follows: an editing field's value is the document's own, not something to hand back or
// clear. A <textarea>'s rendered content has no `value` attribute to compare against -- it's the
// element's text at parse time, which the DOM keeps as `defaultValue` even after typing changes
// `value`. Same comparison, different property. A <select> has neither: what was rendered is the
// option it was drawn showing, by the browser's own rule (drawnOption), until someone chooses. A
// box holds a tick, not its value: what was rendered is whether it was drawn `checked`
// (`defaultChecked`). A group of radios is one field, held as the value chosen (form-value.ts):
// what was rendered is the value of the last drawn `checked`, or null.
// "input" (bento-request.md K3) is the same commit, debounced to ~150ms after the last keystroke
// anywhere in the form so a burst of typing becomes one message, not one per key; a `focusout`
// inside such a form flushes any pending write at once, same as leaving the field would for
// "blur". Whatever the trigger, a commit identical to the last one *this form* sent is dropped
// until a write lands -- typing back to a value on its way, or leaving a field twice, says nothing
// new -- and not after: once an echo or an undo has been drawn, the same value is news again.
function rendered(field: Field): string | boolean | null {
  if (isBox(field)) return field.defaultChecked;
  if (isRadio(field)) return groupOf(field).findLast((r) => r.defaultChecked)?.value ?? null;
  if (field instanceof HTMLSelectElement) return drawnOption(field)?.value ?? "";
  return field instanceof HTMLTextAreaElement ? field.defaultValue : (field.getAttribute("value") ?? "");
}

function editingChange(form: HTMLFormElement): { doc: string; ops: PatchOp[] } | undefined {
  const ops: PatchOp[] = [];
  let doc: string | undefined;
  const said = new Set<Field>(); // a group of radios is said once
  for (const field of [...form.querySelectorAll("[data-write]")].filter(isField)) {
    if (said.has(field)) continue;
    if (isRadio(field)) for (const r of groupOf(field)) said.add(r);
    const value = held(field);
    if (value === rendered(field)) continue;
    const spec = JSON.parse(field.dataset.write!) as WriteSpec;
    doc = spec.doc;
    ops.push({ op: spec.op, path: spec.path, value });
  }
  return doc && ops.length > 0 ? { doc, ops } : undefined;
}

function onEditTrigger(event: Event, trigger: "blur" | "change") {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.matches("[data-write]")) return;
  const form = field.closest("form");
  if (!form || form.dataset.writeOn !== trigger) return;
  commitEdit(form);
}

const INPUT_DEBOUNCE_MS = 150;
const inputTimers = new WeakMap<HTMLFormElement, ReturnType<typeof setTimeout>>();
// The ops of the last message *this form* actually sent, until a write lands, so retyping back to
// an already-sent value doesn't repeat it -- keyed by form, not by field, since a commit is
// every changed field in one message (bento-request.md K3).
let lastEditSent = new WeakMap<HTMLFormElement, string>();

function commitEdit(form: HTMLFormElement) {
  const change = editingChange(form);
  if (!change) return;
  const key = JSON.stringify(change.ops);
  if (lastEditSent.get(form) === key) return;
  lastEditSent.set(form, key);
  send(change.doc, change.ops);
}

function flushInputEdit(form: HTMLFormElement) {
  const timer = inputTimers.get(form);
  if (timer === undefined) return;
  clearTimeout(timer);
  inputTimers.delete(form);
  commitEdit(form);
}

function onInput(event: Event) {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.matches("[data-write]")) return;
  const form = field.closest("form");
  if (!form || form.dataset.writeOn !== "input") return;
  const existing = inputTimers.get(form);
  if (existing !== undefined) clearTimeout(existing);
  inputTimers.set(
    form,
    setTimeout(() => {
      inputTimers.delete(form);
      commitEdit(form);
    }, INPUT_DEBOUNCE_MS),
  );
}

// `focusout` (bubbles), not `blur` (doesn't): the field-losing-focus trigger, for text-like
// fields typed into. `change` fires on its own for a field that commits immediately (a checkbox,
// a select) as well as a blurred text field, so a form only ever needs one or the other. An
// "input" form also flushes any pending debounced write here, rather than waiting the debounce
// out once the person has already moved on.
app.addEventListener("focusout", (event) => {
  onEditTrigger(event, "blur");
  const field = event.target;
  const form = field instanceof HTMLElement ? field.closest("form") : null;
  if (form?.dataset.writeOn === "input") flushInputEdit(form);
});
app.addEventListener("change", (event) => onEditTrigger(event, "change"));
app.addEventListener("input", onInput);

function connect() {
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  socket = new WebSocket(url);

  // A successful connection means prior turbulence is over: the next drop,
  // whenever it happens, should retry promptly rather than inherit an old backoff.
  socket.addEventListener("open", () => {
    reconnectDelay = RECONNECT_DELAY_MS;
    app.inert = false;
    delete app.dataset.offline;
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "render") {
      if (message.ops) applyFragments(message.ops);
      else {
        // the page whole before the echo: the form's write was refused -- what was sent goes back
        // in each field (a group of radios is one) not typed in, chosen in, or ticked, since; the
        // morph then keeps a choice by its value, or shows the drawn one if the page no longer offers it (morph.ts)
        for (const [field, value] of sending?.sent ?? []) if (held(field) === rendered(field)) hold(field, value);
        sending = undefined;
        render(message.html);
      }
    } else if (message.type === "patch") {
      recordPatch(message.doc, message.version, message.ops);
      // An applet watching this document takes the ops itself (see Applet.patch): the delta is
      // its update, and no render need follow.
      for (const el of mounted.keys()) {
        if (el.dataset.doc === message.doc) applets[el.dataset.applet!]?.patch?.(el, message.ops);
      }
      if (lastSent && isNamed(lastSent.doc, message.doc) && message.ops.length > 0) lastSent.echoed = true;
      if (sending && isNamed(sending.doc, message.doc) && message.ops.length > 0) sending = undefined; // it landed
      if (message.ops.length > 0) lastEditSent = new WeakMap(); // a write landed: what was sent may be said again
    }
  });

  // The connection gone, the page stays as it is -- what is typed, what applets hold -- but is not
  // to be used (src/bento.css says so) until the server, reached again, draws it afresh.
  socket.addEventListener("close", () => {
    app.inert = true;
    app.dataset.offline = "";
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", () => socket?.close());
}

connect();
