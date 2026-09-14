import { applets } from "../applets";
import "../applets/room-picker"; // registers itself; app.ts only knows the generic mount contract
import type { PatchOp } from "../json-patch";
import { morph } from "./morph";

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
function render(html: string) {
  const autoscrolled = [...app.querySelectorAll<HTMLElement>("[data-autoscroll]")];
  const before = autoscrolled.map((el) => el.childNodes.length);

  morph(app, html, { onAppletRemoved, onAppletPropsChanged });
  mountApplets();

  // Only pin to the bottom if this render actually added content here --
  // an unrelated update (someone else's presence, an undo elsewhere) must
  // not yank the scroll position out from under someone reading history.
  autoscrolled.forEach((el, i) => {
    if (app.contains(el) && el.childNodes.length > before[i]) el.scrollTop = el.scrollHeight;
  });
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
// value, a button/li's data-value is the value, nothing else goes up.
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const spec = form.dataset.write;
  if (!spec) return;
  const { doc, op, path } = JSON.parse(spec) as WriteSpec;
  const values = [...new FormData(form).values()];
  const value = values.length === 1 ? values[0] : undefined;
  pendingReset = { form, doc };
  send(doc, [{ op, path, value }]);
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-write]");
  if (!target || target.tagName === "FORM") return;
  event.preventDefault();
  const { doc, op, path } = JSON.parse(target.dataset.write!) as WriteSpec;
  const value = target.dataset.value;
  send(doc, value !== undefined ? [{ op, path, value }] : [{ op, path }]);
});

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
      render(message.html);
    } else if (message.type === "patch") {
      recordPatch(message.doc, message.version, message.ops);
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
