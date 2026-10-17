// What eta's browser tests share (`Bun.WebView`): a view that is a browser of its own, a wait on
// what it shows, and a press as a mouse makes one.

let views = 0;
const hosts = new WeakMap<Bun.WebView, string>();
const chromes = new WeakSet<Bun.WebView>();

/**
 * A test's Chrome reaches nothing beyond this machine: a page's web fonts (the wedding's, the
 * model's) would cost each view a second, its host new to the cache, and the tests their offline.
 */
const HERE_ONLY = "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost";

/**
 * A test's view: on Chrome on every platform, whose DevTools say what of the client a page ran
 * (src/client-coverage.ts). A Chrome of the tests' own, never one already running.
 */
export function webview(options: Bun.WebView.ConstructorOptions = {}): Bun.WebView {
  const view = new Bun.WebView({ ...options, backend: { type: "chrome", url: false, argv: [HERE_ONLY] } });
  chromes.add(view);
  return view;
}

/** Whether `view` is a test's, on Chrome. */
export const measured = (view: Bun.WebView): boolean => chromes.has(view);

/**
 * Where `view` goes for `path` on the server at `url`, as a browser of its own. On Chrome (a
 * test's, or any on Linux) every view in a process shares one profile, and a cookie ignores the
 * port, so a second view would open already signed in as the first. Each view is given a host of
 * its own instead -- Chrome takes every `*.localhost` to this machine -- and keeps it, so a
 * reload or a link is the same person. WebKit's views (macOS, by hand) are apart already.
 */
export function urlFor(view: Bun.WebView, url: URL | string, path = "", platform: string = process.platform): string {
  const address = new URL(path, url);
  if (platform === "darwin" && !chromes.has(view)) return address.toString();
  if (!hosts.has(view)) hosts.set(view, `view${++views}.localhost`);
  address.hostname = hosts.get(view)!;
  return address.toString();
}

/**
 * Evaluates `script` in `view` until `predicate` holds of it, and resolves with that value; throws, with the last value, after `timeout` ms.
 * The wait is measured by `performance.now()`, not the date, which a test may fix (`setSystemTime`) to open a page on a given day.
 */
export async function waitFor(view: Bun.WebView, script: string, predicate: (value: unknown) => boolean, timeout = 5000): Promise<unknown> {
  const start = performance.now();
  let last: unknown;
  while (performance.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

/** What an element is, as the page's own function: its tag, its id and its classes (`div#veil.scrim`). */
export const NAMED = `((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].map((c) => "." + c).join(""))`;

/** An element scrolled to the middle of the view, as the page's own function: its box, and the middle of it, where a press goes. */
export const CENTRED = `((el) => {
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  return { r, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})`;

/**
 * A mouse, as the page's own function (its source, for a script run in the page): pressed at the
 * first of `points`, moved through the rest, let go at the last. Each pointer event goes to what is
 * under the pointer when it is sent, and a mouse event after it unless the press was cancelled;
 * then the click goes where a browser sends it, to what the press and the release share, if that
 * is still on the page. A page that redraws on the press or the release is pressed as a person's.
 */
export const MOUSE = `((points) => {
  let mice = true;
  const at = (type, [x, y], button, buttons) => {
    const el = document.elementFromPoint(x, y);
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const sent = el.dispatchEvent(new PointerEvent("pointer" + type, init));
    if (type === "down") mice = sent;
    if (mice) el.dispatchEvent(new MouseEvent("mouse" + type, init));
    return el;
  };
  const down = at("down", points[0], 0, 1);
  for (const p of points.slice(1)) at("move", p, -1, 1);
  const up = at("up", points.at(-1), 0, 0);
  let shared = down;
  while (shared && !shared.contains(up)) shared = shared.parentElement;
  const [x, y] = points.at(-1);
  if (shared && shared.isConnected) shared.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y }));
})`;

/**
 * Presses what `selector` names as a person does with a mouse: scrolled into view, then pressed
 * and let go at its middle (MOUSE). Never `element.click()`, which sends no pointerdown or
 * pointerup and reaches the element whatever is drawn over it. Waits up to `timeout` ms for it
 * to be pressable -- not disabled, and nothing else at its middle -- then throws, saying why not.
 */
export async function press(view: Bun.WebView, selector: string, timeout = 2000): Promise<void> {
  let why: unknown;
  const pressed = `((selector) => {
    const el = document.querySelector(selector);
    if (!el) return "it is not on the page";
    if (el.closest(":disabled:not(fieldset)")) return "it is disabled"; // a control, or in one, disabled itself or by its fieldset
    const { x, y } = ${CENTRED}(el);
    const top = document.elementFromPoint(x, y);
    if (!top || !el.contains(top)) return "at its middle is " + (top ? ${NAMED}(top) : "nothing");
    ${MOUSE}([[x, y]]);
    return "";
  })(${JSON.stringify(selector)})`;
  await waitFor(view, pressed, (v) => (why = v) === "", timeout).catch((err: Error) => {
    throw new Error(`cannot press ${selector}: ${why ?? err.message}`); // why it could not, or the page's own error
  });
}
