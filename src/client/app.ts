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

function render(html: string) {
  const before = new Map([...app.querySelectorAll<HTMLElement>("[data-autoscroll]")].map((el) => [el, el.childNodes.length]));

  morph(app, html, hooks);
  settle(before);
  syncPage();
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

// A `data-write-on="blur"|"change"` form is an editing one, not a creating one: `data-write`
// lives on its *fields*, each naming its own path, and the form commits on that trigger instead
// of a submit -- one op per field whose live value has diverged from what the last render put in
// its `value` attribute (not a dirty flag; the morph keeps that attribute current, so a field an
// unrelated render touched doesn't look changed just because it exists). No reset follows: an
// editing field's value is the document's own, not something to hand back or clear.
// A <textarea>'s rendered content has no `value` attribute to compare against -- it's the
// element's text at parse time, which the DOM keeps as `defaultValue` even after typing changes
// `value`. Same comparison, different property.
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

// `focusout` (bubbles), not `blur` (doesn't): the field-losing-focus trigger, for text-like
// fields typed into. `change` fires on its own for a field that commits immediately (a checkbox,
// a select) as well as a blurred text field, so a form only ever needs one or the other.
app.addEventListener("focusout", (event) => onEditTrigger(event, "blur"));
app.addEventListener("change", (event) => onEditTrigger(event, "change"));

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
