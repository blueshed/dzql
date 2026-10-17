// What the client's browser tests share (app.test.ts, tools.test.ts): no eta server. app.ts connects
// a real WebSocket on load, so `/ws` just has to accept the upgrade and go quiet -- each test drives
// the client itself, its socket's `send` recording what the page sends (`stubSend`), and sending
// what the server would as "message" events on that same socket (`push`).
import { afterAll, beforeAll } from "bun:test";
import { renderMessage } from "../compartments/render";
import { waitFor, webview } from "../webview";

/** What the socket says, whatever it is told: nothing. */
const quiet = (): void => {};

/**
 * Serves `pages` beside a quiet `/ws` for the tests of the file that calls it, and answers how to
 * open one: a fresh view on it, its socket open and its sends recorded.
 */
export function quietPages(pages: Record<string, Bun.HTMLBundle>): (path?: string) => Promise<Bun.WebView> {
  let server: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: { ...pages, "/ws": (req, server) => (server.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 })) },
      websocket: { open: quiet, message: quiet },
    });
  });
  afterAll(() => server.stop(true));
  return async (path = "/") => {
    const view = webview();
    await view.navigate(new URL(path, server.url).toString());
    await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
    await stubSend(view);
    return view;
  };
}

/** Replaces the live socket's `send` with one that records each write to `window.__sent` instead of
 * putting it on the wire, its id, which the server would hand back, kept apart in `window.__ids`. */
export async function stubSend(view: Bun.WebView): Promise<void> {
  await view.evaluate(`(() => {
    window.__sent = [];
    window.__ids = [];
    window.eta.socket().send = (data) => { const { id, ...write } = JSON.parse(data); window.__ids.push(id); window.__sent.push(write); };
  })()`);
}

/** As stubSend, for every socket, the next one's too; as a real socket does, one not open drops what it is given. */
export async function stubEverySocket(view: Bun.WebView): Promise<void> {
  await view.evaluate(`(() => { window.__sent = []; window.__ids = []; const send = function (d) { const { id, ...write } = JSON.parse(d); if (this.readyState === 1) { window.__ids.push(id); window.__sent.push(write); } }; WebSocket.prototype.send = send; window.eta.socket().send = send; })()`);
}

/** Waits for a socket other than `window.__old`, the one the test closed, to be open and the page usable again. */
export const reconnected = (view: Bun.WebView) =>
  waitFor(view, `window.eta.socket() !== window.__old && window.eta.socket().readyState === 1 && !document.getElementById('app').inert`, (v) => v === true, 4000);

/** Sends the page any message as the server would -- a render, a patch, a refusal -- on app.ts's own socket; a string as it is. */
export async function push(view: Bun.WebView, message: unknown): Promise<void> {
  const data = typeof message === "string" ? message : JSON.stringify(message);
  await view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(data)} }))`);
}

/** The server drawing the page whole (src/compartments/render.ts's `renderMessage`). */
export const pushRender = (view: Bun.WebView, html: string) => push(view, renderMessage(html));

/** The id of the last write this page sent, which its echo or its refusal hands back. */
export const lastId = (view: Bun.WebView): Promise<number> => view.evaluate<number>(`window.__ids.at(-1)`);

/** The server refusing this page's last write, and why if `reason`, then handing the page back whole, as src/server.ts does. */
export async function pushRefused(view: Bun.WebView, html: string, reason?: string): Promise<void> {
  await push(view, { type: "refused", id: await lastId(view), reason });
  await pushRender(view, html);
}
