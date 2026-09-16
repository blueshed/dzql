import { applets } from "../applets";
import type { PatchOp } from "../json-patch";
import { formValue } from "./form-value";
import type { HtmlOp } from "../compartments/render";
import { morph, morphElement, removeNode } from "./morph";

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
const hooks = { onAppletRemoved, onAppletPropsChanged };

// Where a tab is (change-request.md item 3): an example may mark some element within #app with
// `data-page` (the session's own idea of the page) and `data-page-write` (the write that sets
// it) -- the kernel knows nothing about what a "page" means, only that this pair, when present,
// should be mirrored into the URL so the back button and a shared link work. `knownPage` is
// undefined until the first full render, which is also the only time the URL might already
// disagree with the session (a shared link, a reload): then the session is caught up to the URL
// instead of the other way round, since the URL is what the person actually asked for.
let knownPage: string | undefined;
let pageWrite: WriteSpec | undefined;

function syncPage() {
  const el = app.querySelector<HTMLElement>("[data-page]");
  if (!el) return;
  const page = el.dataset.page!;
  if (el.dataset.pageWrite) pageWrite = JSON.parse(el.dataset.pageWrite) as WriteSpec;

  if (knownPage === undefined) {
    const urlPage = decodeURI(location.pathname.slice(1));
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
  const page = decodeURI(location.pathname.slice(1));
  knownPage = page;
  if (pageWrite) send(pageWrite.doc, [{ op: pageWrite.op, path: pageWrite.path, value: page }]);
});

// Rule 7 of bento-request.md's K1: a render may mark one element `data-moving="<name>"`. When
// the page as it is and the page as rendered both carry an element with the same value, that
// element -- and only that one -- grows into the window instead of the page going anywhere.
// `movingElement` parses the incoming HTML (a `<template>`, same technique `applyFragments` uses
// below) to find out whether the render still has it, without touching the live DOM yet.
//
// A box with more than one openable compartment (W3) marks every one of them `data-moving` at
// once -- each is a candidate for the next thing to grow, and the render can't know in advance
// which -- so the page as it is may carry several. Only one of them is actually transitioning:
// the one whose matching element in the render differs from what's on screen now (a still-closed
// sibling's markup is byte-for-byte the same before and after, since nothing about it changed).
function movingElement(html: string): HTMLElement | undefined {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  for (const current of app.querySelectorAll<HTMLElement>("[data-moving]")) {
    const stillThere = holder.content.querySelector(`[data-moving="${CSS.escape(current.dataset.moving!)}"]`);
    if (stillThere && stillThere.outerHTML !== current.outerHTML) return current;
  }
  return undefined;
}

// Rule 18 of bento-request.md's K2: after a full render's morph, an element newly carrying
// `data-reveal` (or carrying it for the first time on a different element than before) scrolls
// into view -- the window itself never moves, only the reading beside it. `previous` is captured
// before the morph runs, since the morph is what may add, move, or remove the attribute.
function revealChanged(previous: Element | null): void {
  const current = app.querySelector<HTMLElement>("[data-reveal]");
  if (current && current !== previous) current.scrollIntoView({ block: "nearest", inline: "nearest" });
}

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
    document.startViewTransition(apply).finished.finally(() => {
      moving.style.viewTransitionName = "";
    });
  } else {
    apply();
  }
}

// A fragment render: the delta in HTML's terms (see src/compartments/render.ts). Each op names an
// element by selector; a target the page no longer has is skipped -- the next full render puts
// things right, as it would after a reconnect.
function applyFragments(ops: HtmlOp[]) {
  const before = new Map([...app.querySelectorAll<HTMLElement>("[data-autoscroll]")].map((el) => [el, el.childNodes.length]));

  for (const op of ops) {
    const target = app.querySelector(op.target);
    if (!target) continue;
    if (op.op === "replace") {
      morphElement(target, op.html, hooks);
    } else if (op.op === "add") {
      const holder = document.createElement("template");
      holder.innerHTML = op.html;
      target.append(holder.content);
    } else {
      removeNode(target, hooks);
    }
  }
  settle(before);
}

// After any render, full or fragment: mount what appeared, and pin what grew.
function settle(before: Map<HTMLElement, number>) {
  mountApplets();

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

function send(doc: string, ops: PatchOp[]) {
  lastSent = { doc, ops, echoed: false };
  socket?.send(JSON.stringify({ doc, ops }));
}

// A form resets on the echo of its own write, not on submit, so a refused
// or lost write hands the person's text back instead of silently eating it.
let pendingReset: { form: HTMLFormElement; doc: string } | undefined;

// An element says what it writes via data-write; a form's field is the
// value (or a record of its fields, if it has more than one), a button/li's
// data-value is the value, nothing else goes up.
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const spec = form.dataset.write;
  if (!spec) return;
  const { doc, op, path } = JSON.parse(spec) as WriteSpec;
  pendingReset = { form, doc };
  send(doc, [{ op, path, value: formValue(form) }]);
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-write]");
  if (!target || target.tagName === "FORM") return;
  event.preventDefault();
  const { doc, op, path } = JSON.parse(target.dataset.write!) as WriteSpec;
  const value = target.dataset.value;
  send(doc, value !== undefined ? [{ op, path, value }] : [{ op, path }]);
});

// A `data-write-on="blur"|"change"|"input"` form is an editing one, not a creating one:
// `data-write` lives on its *fields*, each naming its own path, and the form commits on that
// trigger instead of a submit -- one op per field whose live value has diverged from what the
// last render put in its `value` attribute (not a dirty flag; the morph keeps that attribute
// current, so a field an unrelated render touched doesn't look changed just because it exists).
// No reset follows: an editing field's value is the document's own, not something to hand back or
// clear. A <textarea>'s rendered content has no `value` attribute to compare against -- it's the
// element's text at parse time, which the DOM keeps as `defaultValue` even after typing changes
// `value`. Same comparison, different property.
// "input" (bento-request.md K3) is the same commit, debounced to ~150ms after the last keystroke
// anywhere in the form so a burst of typing becomes one message, not one per key; a `focusout`
// inside such a form flushes any pending write at once, same as leaving the field would for
// "blur". A commit identical to the last one *this form* actually sent is dropped rather than
// resent -- typing back to an already-sent value shouldn't repeat it on the wire.
function rendered(field: HTMLInputElement | HTMLTextAreaElement): string {
  return field instanceof HTMLTextAreaElement ? field.defaultValue : (field.getAttribute("value") ?? "");
}

function editingChange(form: HTMLFormElement): { doc: string; ops: PatchOp[] } | undefined {
  const ops: PatchOp[] = [];
  let doc: string | undefined;
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-write]")) {
    if (field.value === rendered(field)) continue;
    const spec = JSON.parse(field.dataset.write!) as WriteSpec;
    doc = spec.doc;
    ops.push({ op: spec.op, path: spec.path, value: field.value });
  }
  return doc && ops.length > 0 ? { doc, ops } : undefined;
}

function onEditTrigger(event: Event, trigger: "blur" | "change") {
  const field = event.target;
  if (!(field instanceof HTMLElement) || !field.matches("[data-write]")) return;
  const form = field.closest("form");
  if (!form || form.dataset.writeOn !== trigger) return;
  const change = editingChange(form);
  if (change) send(change.doc, change.ops);
}

const INPUT_DEBOUNCE_MS = 150;
const inputTimers = new WeakMap<HTMLFormElement, ReturnType<typeof setTimeout>>();
// The ops of the last message *this form* actually sent, so retyping back to an
// already-sent value doesn't repeat it -- keyed by form, not by field, since a commit is
// every changed field in one message (bento-request.md K3).
const lastEditSent = new WeakMap<HTMLFormElement, string>();

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
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "render") {
      if (message.ops) applyFragments(message.ops);
      else render(message.html);
    } else if (message.type === "patch") {
      recordPatch(message.doc, message.version, message.ops);
      // An applet watching this document takes the ops itself (see Applet.patch): the delta is
      // its update, and no render need follow.
      for (const el of mounted.keys()) {
        if (el.dataset.doc === message.doc) applets[el.dataset.applet!]?.patch?.(el, message.ops);
      }
      if (lastSent && lastSent.doc === message.doc && message.ops.length > 0) lastSent.echoed = true;
      if (pendingReset && pendingReset.doc === message.doc && message.ops.length > 0) {
        pendingReset.form.reset();
        pendingReset = undefined;
      }
    }
  });

  socket.addEventListener("close", () => {
    render("Disconnected. Reconnecting&hellip;");
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", () => socket?.close());
}

connect();
