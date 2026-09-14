const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10_000;

const app = document.querySelector<HTMLElement>("#app")!;
let socket: WebSocket | undefined;

function render(html: string) {
  app.innerHTML = html;
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
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-event]");
  if (!target || target.tagName === "FORM") return;
  event.preventDefault();
  send(target.dataset.event!, {});
});

function connect(delay = RECONNECT_DELAY_MS) {
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  socket = new WebSocket(url);

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "render") render(message.html);
  });

  socket.addEventListener("close", () => {
    render("Disconnected. Reconnecting&hellip;");
    setTimeout(() => connect(Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)), delay);
  });

  socket.addEventListener("error", () => socket?.close());
}

connect();
