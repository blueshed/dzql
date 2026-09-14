import { applets } from "./applets";
import "./applets/room-picker"; // registers itself; app.ts only knows the generic mount contract

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10_000;

const app = document.querySelector<HTMLElement>("#app")!;
let socket: WebSocket | undefined;

const mounted = new Map<HTMLElement, () => void>();

function unmountAll() {
  for (const cleanup of mounted.values()) cleanup();
  mounted.clear();
}

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

function resolveTarget(selector: string): HTMLElement | null {
  return selector === "#app" ? app : app.querySelector<HTMLElement>(selector);
}

function applyPostUpdateBehaviors() {
  app.querySelector<HTMLElement>("[autofocus]")?.focus();
  app.querySelectorAll<HTMLElement>("[data-autoscroll]").forEach((el) => {
    el.scrollTop = el.scrollHeight;
  });
  mountApplets();
}

function render(html: string, selector = "#app") {
  const target = resolveTarget(selector);
  if (!target) return;
  if (target === app) unmountAll();
  target.innerHTML = html;
  applyPostUpdateBehaviors();
}

function appendHtml(selector: string, html: string) {
  const target = resolveTarget(selector);
  if (!target) return;
  target.insertAdjacentHTML("beforeend", html);
  applyPostUpdateBehaviors();
}

function send(name: string, payload: Record<string, unknown> = {}) {
  socket?.send(JSON.stringify({ name, payload }));
}

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const eventName = form.dataset.event;
  if (!eventName) return;
  send(eventName, Object.fromEntries(new FormData(form)));
  form.reset();
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-event]");
  if (!target || target.tagName === "FORM") return;
  event.preventDefault();
  const { event: eventName, ...payload } = target.dataset;
  send(eventName!, payload);
});

function connect(delay = RECONNECT_DELAY_MS) {
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  socket = new WebSocket(url);

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "render") render(message.html, message.selector);
    else if (message.type === "append") appendHtml(message.selector, message.html);
  });

  socket.addEventListener("close", () => {
    render("Disconnected. Reconnecting&hellip;");
    setTimeout(() => connect(Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)), delay);
  });

  socket.addEventListener("error", () => socket?.close());
}

connect();
