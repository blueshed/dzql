import { applets } from "../applets";
import "../applets/room-picker"; // registers itself; app.ts only knows the generic mount contract
import type { PatchOp } from "../json-patch";

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

declare global {
  interface Window {
    eta?: {
      docs(): Record<string, { version: number; ops: PatchOp[] }>;
      reconnectDelay(): number;
      socket(): WebSocket | undefined;
    };
  }
}

let reconnectDelay = RECONNECT_DELAY_MS;
window.eta = {
  docs: () => Object.fromEntries(docs),
  reconnectDelay: () => reconnectDelay,
  socket: () => socket,
};

const mounted = new Map<HTMLElement, () => void>();

function unmountAll() {
  for (const cleanup of mounted.values()) cleanup();
  mounted.clear();
}

// `target` itself may carry the matched attribute (e.g. <ul class="messages" data-autoscroll>
// is the append target), not just contain it, so check both rather than only descendants.
function matchesOrContains<T extends Element>(root: Element, selector: string): T[] {
  const self = root.matches(selector) ? [root as unknown as T] : [];
  return [...self, ...root.querySelectorAll<T>(selector)];
}

function mountApplets(scope: HTMLElement) {
  matchesOrContains<HTMLElement>(scope, "[data-applet]").forEach((el) => {
    if (mounted.has(el)) return;
    const applet = applets[el.dataset.applet!];
    if (!applet) return;
    const props = el.dataset.props ? JSON.parse(el.dataset.props) : undefined;
    const cleanup = applet.mount(el, { props, send });
    mounted.set(el, cleanup ?? (() => {}));
  });
}

function resolveTarget(selector: string): HTMLElement | null {
  return selector === "#app" ? app : app.querySelector<HTMLElement>(selector);
}

// Scoped to `target`, not the whole page: an unrelated update elsewhere (e.g. a
// presence-only render of .people) must not steal focus or reset scroll position.
function applyPostUpdateBehaviors(target: HTMLElement) {
  matchesOrContains<HTMLElement>(target, "[autofocus]")[0]?.focus();
  matchesOrContains<HTMLElement>(target, "[data-autoscroll]").forEach((el) => {
    el.scrollTop = el.scrollHeight;
  });
  mountApplets(target);
}

function render(html: string, selector = "#app") {
  const target = resolveTarget(selector);
  if (!target) return;
  if (target === app) unmountAll();
  target.innerHTML = html;
  applyPostUpdateBehaviors(target);
}

function appendHtml(selector: string, html: string) {
  const target = resolveTarget(selector);
  if (!target) return;
  target.insertAdjacentHTML("beforeend", html);
  applyPostUpdateBehaviors(target);
}

type WriteSpec = { doc: string; op: PatchOp["op"]; path: string };

function send(doc: string, ops: PatchOp[]) {
  socket?.send(JSON.stringify({ doc, ops }));
}

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
  send(doc, [{ op, path, value }]);
  form.reset();
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
    if (message.type === "render") render(message.html, message.selector);
    else if (message.type === "append") appendHtml(message.selector, message.html);
    else if (message.type === "patch") recordPatch(message.doc, message.version, message.ops);
  });

  socket.addEventListener("close", () => {
    render("Disconnected. Reconnecting&hellip;");
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", () => socket?.close());
}

connect();
