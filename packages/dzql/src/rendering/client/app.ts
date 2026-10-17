import { applets } from "../applets";
import { applyPatch, WIRE, type PatchOp, type Test } from "../json-patch";
import { formValue, groupOf, held, isBox, isField, isRadio, pressed, rendered, sends, type Field } from "./form-value";
import type { HtmlOp } from "../compartments/render";
import { keepingChoices, morph, morphElement, morphTag, removeNode, type MorphHooks } from "./morph";

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_OPS_KEPT_PER_DOC = 5;

const app = document.querySelector<HTMLElement>("#app")!;
let socket: WebSocket | undefined;

// What the client has seen of each document's writes: not domain state, just
// an echo log, so a person at the console can read the session back.
const docs = new Map<string, { version: number; ops: PatchOp[] }>();

// The last write this client sent, and what became of it, told by its own id: echoed back to it,
// or refused, and why when the refusal says -- never anyone else's echo of its document, nor the
// refusal of a write sent before it -- or unanswered, its socket gone first. Not domain state, just
// enough to answer "did that even go through" from the console.
let lastSent: { id: number; doc: string; ops: Op[]; echoed: boolean; refused: boolean; reason?: string; unanswered?: true } | undefined;

/**
 * What became of a write a script sent: echoed, what it changed, with the handle that
 * names the change (undo takes it); refused, and why when the refusal says; unanswered, its
 * socket gone first; or unsent, and why -- the socket not open, or an input no control of the page's
 * takes.
 */
export type Answer =
  | { id: number; echoed: true; doc: string; version: number; ops: PatchOp[]; change?: string }
  | { id: number; refused: true; reason?: string }
  | { id: number; unanswered: true }
  | { unsent: string };

/** An op of a write: a verb, or a `test` of what a field typed in was drawn with. */
type Op = PatchOp | Test;

/** A write: a document's name and its ops, as a control sends them. */
export type Write = { doc: string; ops: Op[] };

/** The writes a script is waiting to hear of, by id. */
const hearing = new Map<number, (answer: Answer) => void>();

declare global {
  interface Window {
    eta?: {
      docs(): Record<string, { version: number; ops: PatchOp[] }>;
      reconnectDelay(): number;
      socket(): WebSocket | undefined;
      inspect(): { docs: Record<string, { version: number; ops: PatchOp[] }>; lastSent: typeof lastSent };
      send(doc: string, ops: Op[]): Promise<Answer>;
      undo(change?: string): Promise<Answer>;
      redo(change?: string): Promise<Answer>;
      /** An app that imports src/client/tools.ts: the page's writes as tools, and one used by name. */
      tools?(): { name: string; title: string; description: string; inputSchema: object }[];
      use?(name: string, input?: Record<string, unknown>): Promise<Answer>;
    };
  }
}

const NOT_CONNECTED = "The page is not connected just now: try again in a moment.";

/** Sends a write, as the page's own controls do, and resolves with what became of it; given why a write is none, answers that. */
export function ask(write: Write | string): Promise<Answer> {
  if (typeof write === "string") return Promise.resolve({ unsent: write });
  const id = send(write.doc, write.ops);
  if (id === undefined) return Promise.resolve({ unsent: NOT_CONNECTED });
  return new Promise((resolve) => hearing.set(id, resolve));
}

/** Tells the script waiting on write `id` what became of it, once. */
function heard(id: unknown, answer: Answer): void {
  hearing.get(id as number)?.(answer);
  hearing.delete(id as number);
}

/** The ledger write that walks the session's last change, or the one `change` names (the handle a write's answer gave); the server says which handles are the session's. */
export const walked = (way: "undo" | "redo", change?: unknown): Write => ({ doc: "ledger", ops: [{ op: way === "undo" ? "remove" : "add", path: `/${change ?? "latest"}` }] });

/** What runs after each drawing, the page as it now is: a module an app opts into (src/client/tools.ts). */
const drawn: (() => void)[] = [];
export const afterDrawing = (fn: () => void): void => void drawn.push(fn);

let reconnectDelay = RECONNECT_DELAY_MS;
window.eta = {
  docs: () => Object.fromEntries(docs),
  reconnectDelay: () => reconnectDelay,
  socket: () => socket,
  inspect: () => ({ docs: Object.fromEntries(docs), lastSent }),
  send: (doc, ops) => ask({ doc, ops }),
  undo: (change) => ask(walked("undo", change)),
  redo: (change) => ask(walked("redo", change)),
};

// Each mounted applet: its cleanup, and its props -- as a render gave them, with every patch to the
// document it watches (`data-doc`) laid on since, at `data-under`: what it draws from -- and the
// document's version they hold (`data-v`), when the mount says it. Not domain state of the
// client's own: the mount's, which the applet holds whatever the client does.
type Held = { cleanup: () => void; props: unknown; v?: number };
const mounted = new Map<HTMLElement, Held>();

/** The version of its document a mount's props hold, as the render says it; none when it does not. */
const versionOf = (el: HTMLElement): number | undefined => (el.dataset.v === undefined ? undefined : Number(el.dataset.v));

function mountApplets() {
  app.querySelectorAll<HTMLElement>("[data-applet]").forEach((el) => {
    if (mounted.has(el)) return;
    const applet = applets[el.dataset.applet!];
    if (!applet) return;
    const props = el.dataset.props ? JSON.parse(el.dataset.props) : undefined;
    const cleanup = applet.mount(el, { props, send });
    mounted.set(el, { cleanup: cleanup ?? (() => {}), props, v: versionOf(el) });
  });
}

/**
 * A patch to the document `el` watches: laid on its props at `data-under`, and the applet given
 * them again (`update`) -- or, where it takes the ops itself (`patch`), given those. One at or
 * below the version its props hold is held already: the server's copy moves before its change is
 * told, so a render drawn after it can come first. One that does not land on them is drift, and
 * the page is asked for afresh, which the applet then draws.
 */
function watched(el: HTMLElement, held: Held, version: number, ops: PatchOp[]): void {
  if (held.v !== undefined && version <= held.v) return;
  const under = el.dataset.under ?? "";
  try {
    held.props = applyPatch(held.props, ops.map((op) => ({ ...op, path: under + op.path })));
  } catch {
    return askForThePage();
  }
  if (held.v !== undefined) held.v = version;
  const applet = applets[el.dataset.applet!];
  if (applet?.patch) applet.patch(el, ops);
  else applet?.update?.(el, held.props);
}

/** Asks the server for the page whole: a message that is no write is answered by the page (src/server.ts). Once, until it comes. */
let askedAfresh = false;
function askForThePage(): void {
  if (askedAfresh || socket?.readyState !== WebSocket.OPEN) return;
  askedAfresh = true;
  socket.send(JSON.stringify({ type: "page" }));
}

// A render morphs the existing tree instead of replacing it, so an element a
// person is focused on, typing into, or has scrolled survives a render that
// doesn't concern it -- see morph.ts. [data-applet] elements are a boundary
// the morph never descends into (see onAppletRemoved/onAppletPropsChanged);
// mounting a newly-appeared one still happens here, same as before.
// What someone is pressing, heard on its way down, before the page can stop it. A box someone is
// pressing is theirs until the click lands (the morph's `pressed`): a render drawn between the press
// and the click must not tick it first, or the click unticks it, and sends that, undoing whoever
// ticked it. Pressing its label is pressing it, and so is holding Space on it. And while someone
// presses at all, `holding`, a render keeps no reader's place (placesNow, below).
let boxPressed: Element | undefined;
let holding = false;
const aBox = (el: unknown): HTMLInputElement | undefined => (el instanceof HTMLInputElement && el.type === "checkbox" ? el : undefined);
document.addEventListener(
  "pointerdown",
  (event) => {
    holding = true;
    const at = event.target instanceof Element && app.contains(event.target) ? event.target : undefined;
    if (at) boxPressed = aBox(at.closest("label")?.control ?? at);
  },
  true,
);
document.addEventListener(
  "pointercancel",
  (event) => {
    if (event.target instanceof Node && app.contains(event.target)) boxPressed = undefined;
    if (event.pointerType !== "touch") holding = false; // a touch goes on, as a scroll, until touchend
  },
  true,
);
document.addEventListener("touchstart", () => (holding = true), true);
for (const type of ["pointerup", "touchend", "touchcancel", "contextmenu"]) document.addEventListener(type, () => (holding = false), true); // a menu takes the press: WebKit sends no pointerup
window.addEventListener("blur", () => (holding = false)); // nor when the window loses the press
app.addEventListener("keydown", (event) => {
  if (event.key === " " && aBox(event.target)) boxPressed = aBox(event.target);
});
document.addEventListener("click", () => (boxPressed = undefined), true); // a click lands after its tick
const hooks: MorphHooks = {
  onAppletRemoved(el) {
    mounted.get(el as HTMLElement)?.cleanup();
    mounted.delete(el as HTMLElement);
  },
  onAppletPropsChanged(el, props) {
    const held = mounted.get(el as HTMLElement);
    if (held) Object.assign(held, { props, v: versionOf(el as HTMLElement) }); // a render's: the patches go on from these
    applets[(el as HTMLElement).dataset.applet!]?.update?.(el as HTMLElement, props);
  },
  // a watching applet's props are what it holds, patched since the render that gave them: a render
  // is compared with those, not with its attribute, which is still the first render's
  heldProps(el) {
    const held = (el as HTMLElement).dataset.doc === undefined ? undefined : mounted.get(el as HTMLElement);
    return held && JSON.stringify(held.props);
  },
  pressed: (el) => el === boxPressed,
};

// Where a tab is (docs/dzql/rendering/change-request.md item 3): an example may mark some element within #app with
// `data-page` (the session's own idea of the page) and `data-page-write` (the write that sets
// it) -- the kernel knows nothing about what a "page" means, only that this pair, when present,
// should be mirrored into the URL so the back button and a shared link work. `knownPage` is
// undefined until the first full render, which is also the only time the URL might already
// disagree with the session (a shared link, a reload): then the session is caught up to the URL
// instead of the other way round, since the URL is what the person actually asked for.
let knownPage: string | undefined;
let pageWrite: string | undefined;

/** The page the URL names: its path and, after a `?`, the one thing open over it (src/bento.ts's address). */
const pageInUrl = (): string => decodeURI(location.pathname.slice(1) + location.search);

function syncPage() {
  const el = app.querySelector<HTMLElement>("[data-page]");
  if (!el) return;
  const page = el.dataset.page!;
  if (el.dataset.pageWrite) pageWrite = el.dataset.pageWrite;

  if (knownPage === undefined) {
    const urlPage = pageInUrl();
    if (urlPage !== page && pageWrite) {
      knownPage = urlPage; // the URL already says this; nothing to push once the session catches up
      write(pageWrite, urlPage);
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
  commitFocused();
  if (pageWrite) write(pageWrite, page);
});

// Opening goes nowhere (docs/dzql/rendering/bento-request.md, K1): a render may mark one element `data-moving="<name>"`. When
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
    // and a transition then would swallow the keys of someone typing in it. Nor is being put
    // `inert`: the cells behind an open window are, and hold still.
    if (stillThere && ownTag(stillThere) !== ownTag(current)) return current;
  }
  return undefined;
}

/** An element's own tag, less `inert`. */
function ownTag(el: Element): string {
  const tag = el.cloneNode(false) as Element;
  tag.removeAttribute("inert");
  return tag.outerHTML;
}

// The reading moves, the window does not (docs/dzql/rendering/bento-request.md, K2): after a full render's morph, an element newly carrying
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
  const reading = readingTop(port);
  const covered = reading - topOf(port); // what stands over the top of the view: a header, measured or declared
  const { scrollMarginTop, scrollMarginBottom } = getComputedStyle(current);
  const marginTop = parseFloat(scrollMarginTop);
  const view = port.clientHeight - covered - lengthIn(getComputedStyle(port).scrollPaddingBottom, port.clientHeight);
  const box = current.getBoundingClientRect();
  if (box.height + marginTop + parseFloat(scrollMarginBottom) > view) return port.scrollBy({ top: box.top - reading - marginTop });
  // one that fits comes by the browser's nearest edge, told of a header it does not know of for the moment
  const declared = getComputedStyle(port).scrollPaddingTop !== "auto";
  const style = port.getAttribute("style");
  if (!declared && covered > 0) (port as HTMLElement).style.scrollPaddingTop = `${covered}px`;
  current.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!declared && covered > 0) {
    if (style === null) port.removeAttribute("style");
    else port.setAttribute("style", style);
  }
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

/** Where `port`'s view starts, in the window: its top edge inside its border, or for the page the window's top. */
const topOf = (port: Element): number => (port === document.documentElement ? 0 : port.getBoundingClientRect().top + port.clientTop);

/** Across the middle of `port`'s view, where points are looked at. */
const middleOf = (port: Element): number =>
  port === document.documentElement ? port.clientWidth / 2 : port.getBoundingClientRect().left + port.clientLeft + port.clientWidth / 2;

/**
 * Where reading starts in `port`, in the window: below what its `scroll-padding-top` declares, or,
 * with nothing declared, below any bar stuck at its top (a header: position sticky or fixed, over
 * the middle of its view), as measured, a bar stuck under a bar included.
 */
function readingTop(port: Element): number {
  const top = topOf(port);
  const declared = getComputedStyle(port).scrollPaddingTop;
  if (declared !== "auto") return top + lengthIn(declared, port.clientHeight);
  let line = top;
  for (let bars = 0; bars < 3; bars++) {
    const bar = document.elementsFromPoint(middleOf(port), Math.max(line, 0) + 1).find((el) => el !== port && port.contains(el) && /sticky|fixed/.test(getComputedStyle(el).position));
    const below = bar?.getBoundingClientRect().bottom ?? line;
    if (below <= line) break;
    line = below;
  }
  return line;
}

// The reader's place. A render keeps what someone is reading where they read it: a row
// taken out above them, or under a sticky header, must not move the rest. The browsers' own scroll
// anchoring can choose the very row hidden under a header, and the rows below it then slide up
// under the header. So before a render the client notes, in each scroller that is scrolled (the
// page, and any in it, as the bento's window is), the first element at or below where reading
// starts (readingTop), and after it puts that element back where it was. Not while someone is
// pressing (a drag, a scroll by touch, a selection being made); a selection left there is no reason.
type Place = [port: Element, at: Element, top: number, apart: boolean];

/** The first element in `port`, in the page's order, whose top is at or below where reading starts -- in the window: a scroller's top may be scrolled off it, and a point off it cannot be looked at. */
function readerIn(port: Element): Element | undefined {
  const line = Math.max(readingTop(port), 0);
  let at: Element | null | undefined = document.elementsFromPoint(middleOf(port), line + 1).find((el) => el !== port && port.contains(el));
  while (at) {
    const box: DOMRect = at.getBoundingClientRect();
    const boxless: boolean = box.width === 0 && box.height === 0; // display: contents, or nothing drawn
    if (!boxless && box.top >= line) return at;
    at = (boxless || box.bottom > line) && at.firstElementChild ? at.firstElementChild : after(at, port);
  }
  return undefined;
}

/** What follows `el` in `port`, past all it holds. */
function after(el: Element, port: Element): Element | null {
  for (let at: Element | null = el; at && at !== port; at = at.parentElement) if (at.nextElementSibling) return at.nextElementSibling;
  return null;
}

/** Whether `el`, or what holds it inside `port`, is placed apart from the flow of the page: fixed, or absolute. */
function apart(el: Element, port: Element): boolean {
  for (let at: Element | null = el; at && at !== port; at = at.parentElement) if (/fixed|absolute/.test(getComputedStyle(at).position)) return true;
  return false;
}

// The scrollers in the page someone has scrolled, heard as they scroll (a scroll does not bubble, so
// it is heard on its way down): the only ones with a place to keep, so a render looks at no others.
const scrollers = new Set<Element>();
document.addEventListener("scroll", (event) => event.target instanceof Element && scrollers.add(event.target), true);

const depth = (el: Element): number => (el.parentElement ? depth(el.parentElement) + 1 : 0);

function placesNow(): Place[] {
  if (holding) return [];
  for (const el of scrollers) if (!el.isConnected) scrollers.delete(el);
  const scrolled = [...scrollers].filter((el) => app.contains(el) && el.scrollTop > 0 && !(el instanceof HTMLTextAreaElement) && !el.closest("[data-applet]"));
  // the innermost first: a scroller's place is put back before that of the one around it, which may be reading inside it
  const ports = [...scrolled.sort((a, b) => depth(b) - depth(a)), ...(document.documentElement.scrollTop > 0 ? [document.documentElement] : [])];
  return ports.flatMap((port) => {
    const at = readerIn(port);
    return at ? [[port, at, at.getBoundingClientRect().top - topOf(port), apart(at, port)] satisfies Place] : [];
  });
}

/** Puts back what each place read, unless it is gone (what follows takes its place), or the render took it out of the page's flow: a cell grown into the window (`moving`, or now fixed) is not what is read behind it. */
function keepPlaces(places: Place[], moving?: Element): void {
  for (const [port, at, top, was] of places) {
    if (!port.isConnected || !port.contains(at) || moving?.contains(at) || (!was && apart(at, port))) continue;
    const moved = at.getBoundingClientRect().top - topOf(port) - top;
    if (Math.abs(moved) >= 1) port.scrollTop += moved;
  }
}

/**
 * A drawing of the page, whole or in parts, with the same care either way. What the page shows now
 * is noted at once -- what may grow, what is revealed -- and the rest as it is drawn: who has the
 * keyboard, and each reader's place. Then it draws, and puts back each place (but in `moving`, a
 * cell grown into the window), pins what grew, mounts what appeared, gives the keyboard somewhere
 * if the drawing left it nowhere, and follows the page in the URL and a reveal.
 */
function drawing(draw: () => void, moving?: Element): () => void {
  const before = new Map([...app.querySelectorAll<HTMLElement>("[data-autoscroll]")].map((el) => [el, new Set([...el.children].map(known))]));
  const previousReveal = app.querySelector<HTMLElement>("[data-reveal]");
  return () => {
    const keyboard = keyboardAfter();
    const places = placesNow();
    draw();
    seeDrawn();
    keepPlaces(places, moving);
    mountApplets();
    // Pin to the bottom only when this render put something new at its foot, or
    // the element itself just appeared (a fresh load, entering a room) -- an
    // unrelated update (someone else's presence, an undo elsewhere) must not
    // yank the scroll position out from under someone reading history. The foot,
    // not the count: a list that keeps its last fifty takes the oldest out as the
    // newest comes in, and its count stays fifty.
    for (const el of app.querySelectorAll<HTMLElement>("[data-autoscroll]")) {
      const had = before.get(el);
      const foot = el.lastElementChild;
      if (had === undefined || (foot && !had.has(known(foot)))) el.scrollTop = el.scrollHeight;
    }
    keyboard();
    syncPage();
    revealChanged(previousReveal);
    for (const fn of drawn) fn();
  };
}

/** A child of a list as a drawing knows it: by its id, or else by what it is. */
const known = (el: Element): string => (el.id ? `#${el.id}` : el.outerHTML);

function render(html: string) {
  const moving = movingElement(html);
  const apply = drawing(() => morph(app, html, hooks), moving);

  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (moving && !reduced && "startViewTransition" in document) {
    moving.style.viewTransitionName = "moving";
    // `ready` rejects when the transition is skipped -- another render arrived before it settled,
    // or the page is hidden -- which is routine, not an error: the morph still ran, only the animation
    // did not. `finished` rejects only when the morph threw, which is.
    const transition = document.startViewTransition(apply);
    transition.ready.catch(() => {});
    transition.finished.finally(() => {
      moving.style.viewTransitionName = "";
    });
  } else {
    apply();
  }
}

// Where the keyboard goes. Drawing the page again may take away what had the
// keyboard, or put it behind something `inert` (a modal's ground, the box behind a window); then the
// keyboard is nowhere, and it is given, in turn, to: what opened a drawer or a modal that has just
// gone (a dialog, in HTML's words); a field waiting for the caret (`autofocus`: a browser honours it
// once per document, so one a later drawing brings, a modal's first, would otherwise wait for a
// click); the first control of a cell that has just moved (the window's way back as it
// opens, the cell's name as it closes), the one the keyboard was in first. Never from somewhere it is.
const CONTROL = "a[href],button,input,select,textarea,[tabindex]";
const DIALOG = "dialog,[role=dialog]";

/** What opened each drawer or modal on the page: where the keyboard goes back to when it goes. */
const openedBy = new Map<Element, HTMLElement>();
/** The control last pressed, until the page is next drawn: what opened whatever that drawing brings. */
let lastPressed: HTMLElement | undefined;

/** Gives the keyboard to the first that takes it: not gone, disabled, inert or undrawn. */
function giveKeyboard(candidates: Iterable<HTMLElement>): boolean {
  for (const el of candidates) {
    if (!el.isConnected) continue;
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * Notes, before a drawing, who has the keyboard, each cell's own tag and the dialogs open; what it
 * answers, run after, gives the keyboard somewhere if the drawing left it nowhere.
 */
function keyboardAfter(): () => void {
  const focused = document.activeElement;
  const cells = new Map([...app.querySelectorAll<HTMLElement>("[data-moving]")].map((el) => [el.dataset.moving!, ownTag(el)]));
  const dialogs = new Set(app.querySelectorAll(DIALOG));
  return () => {
    const press = lastPressed;
    lastPressed = undefined;
    const gone: HTMLElement[] = [];
    for (const [dialog, by] of openedBy) {
      if (dialog.isConnected) continue;
      openedBy.delete(dialog);
      gone.push(by);
    }
    const opener = press ?? (focused instanceof HTMLElement && focused !== document.body ? focused : undefined);
    for (const dialog of app.querySelectorAll(DIALOG)) {
      // a new one: what was pressed, or had the keyboard, opened it
      if (!dialogs.has(dialog)) {
        if (opener) openedBy.set(dialog, opener);
      } else if (press?.isConnected && !press.closest(DIALOG)) {
        openedBy.set(dialog, press); // one still open, opened again by a press beside it: the next figure beside a docked drawer
      }
    }

    const at = document.activeElement;
    if (at && at !== document.body && !at.closest("[inert]")) return; // it is somewhere
    if (giveKeyboard(gone) || giveKeyboard(app.querySelectorAll<HTMLElement>("[autofocus]"))) return;
    const inside = focused?.closest<HTMLElement>("[data-moving]")?.dataset.moving;
    const moved = [...app.querySelectorAll<HTMLElement>("[data-moving]")]
      .filter((el) => cells.has(el.dataset.moving!) && cells.get(el.dataset.moving!) !== ownTag(el))
      .sort((a, b) => Number(b.dataset.moving === inside) - Number(a.dataset.moving === inside));
    for (const cell of moved) if (giveKeyboard([...cell.querySelectorAll<HTMLElement>(CONTROL)].filter((el) => el.tabIndex >= 0))) return;
  };
}

// The page in parts: what changed since the last drawing, in HTML's terms (src/parts.ts). Each op
// names a part; a target the page no longer has is skipped -- the next full render puts things
// right, as it would after a reconnect. The ops keep a choice not yet drawn as one render does,
// since a group of radios may span parts. Afterwards, the same care as a whole render.
function applyFragments(ops: HtmlOp[]) {
  drawing(() =>
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
    }),
  )();
}

type WriteSpec = { doc: string; op: PatchOp["op"]; path: string };

let writes = 0;

/**
 * Sends a write with an id of its own, from 1, which the server hands back on its echo or its
 * refusal: the id -- or undefined when it did not go: a socket that is not open drops what it is
 * given, so a write then is not recorded as sent.
 */
function send(doc: string, ops: Op[]): number | undefined {
  if (socket?.readyState !== WebSocket.OPEN) return undefined;
  const id = ++writes;
  lastSent = { id, doc, ops, echoed: false, refused: false };
  socket.send(JSON.stringify({ id, doc, ops }));
  return id;
}

/** Sends the write an element names (`data-write`, `data-page-write`: its document, op and path), with this value if any. */
function write(spec: string, value?: unknown): number | undefined {
  const { doc, op, path } = JSON.parse(spec) as WriteSpec;
  return send(doc, [{ op, path, value }]);
}

/** A field (form-value.ts) an editing form sends and a refusal hands back. A `multiple` select holds several values where a
 * write carries one, so it is not one here: an editing form never sends it, and a refusal does not hand it back. */
const holdsOne = (el: Element): el is Field => isField(el) && !(el instanceof HTMLSelectElement && el.multiple);

/** Puts back what a field held: a box's tick, a group's choice (by its value; none for null), or a value. */
function hold(field: Field, value: string | boolean | null): void {
  if (isBox(field)) field.checked = value as boolean;
  else if (isRadio(field)) for (const r of groupOf(field)) r.checked = r.value === value;
  else field.value = value as string;
}

// A form clears as it sends, and its write's own refusal hands back what was sent. So what someone
// types while the write is on its way is theirs -- no echo, anyone's, clears it, nor a page sent
// whole for another reason (someone else's write turning this page into another) -- and a refusal
// never eats text. The write's own echo ends the wait: it landed. One whose socket goes first is
// unanswered, and handed back when the page is drawn afresh (the close, below).
let sending: { id: number; sent: [Field, string | boolean | null][]; unanswered?: true } | undefined;

/** What the form's write sent goes back in each field (a group of radios is one) not typed in, chosen in, or ticked since. */
function handBack(): void {
  for (const [field, value] of sending?.sent ?? []) if (held(field) === rendered(field)) hold(field, value);
  sending = undefined;
}

/**
 * What became of this page's own write `id`, by its echo or its refusal: noted on the last write sent
 * when it is that one (a refusal as itself, and why if it says), the form that sent it done waiting
 * -- or, refused, handed back what it sent -- and the script waiting on it told.
 */
function answered(answer: Extract<Answer, { echoed: true } | { refused: true }>): void {
  const refused = "refused" in answer;
  // not `?.`: another's echo has no id, and would match a page that has sent nothing
  if (lastSent && lastSent.id === answer.id) Object.assign(lastSent, refused ? answer : { echoed: true });
  if (sending && sending.id === answer.id) {
    if (refused) handBack();
    else sending = undefined;
  }
  if (refused) showDrawn();
  else if (answer.id !== undefined) yours = true;
  heard(answer.id, answer);
}

// An element says what it writes via data-write; a form's field is the
// value (or a record of its fields, if it has more than one), a button/li's
// data-value, JSON, is the value with its type, nothing else goes up.
app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const spec = form.dataset.write;
  if (!spec) return; // not a write: a plain form posts as the browser does (a sign-in)
  event.preventDefault();
  const fields = [...form.elements].filter(holdsOne);
  const sent: [Field, string | boolean | null][] = fields.map((f) => [f, held(f)]);
  const id = write(spec, formValue(form));
  if (id === undefined) return; // not sent: what is typed stays
  sending = { id, sent };
  form.reset();
});

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-write]");
  // A form writes on submit, and a field's data-write names its path for an editing form (below):
  // neither is a gesture. Putting the caret in find's field must not send a blank replace.
  if (!target || target.matches("form,input,textarea,select")) return;
  event.preventDefault();
  lastPressed = target;
  write(target.dataset.write!, pressed(target));
});

// Escape puts away what was opened last: it presses the last `[data-escape]` on the page -- a
// modal's scrim is drawn after the drawer it may open over -- as a click would, so it sends that
// control's own write and nothing the page did not offer. What is typed in it is said first.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const away = [...app.querySelectorAll<HTMLElement>("[data-escape]")].at(-1);
  if (!away) return;
  event.preventDefault();
  commitFocused();
  away.click();
});

// A `data-write-on="blur"|"change"|"input"` form is an editing one, not a creating one:
// `data-write` lives on its *fields*, each naming its own path, and the form commits on that
// trigger instead of a submit -- one op per field (a group of radios is one) that no longer holds
// what was rendered into it (`held` and `rendered`, form-value.ts): not a dirty flag, so a field an
// unrelated render touched doesn't look changed just because it exists. No reset follows: an
// editing field's value is the document's own, not something to hand back or clear. "input"
// (docs/dzql/rendering/bento-request.md K3) is the same commit, debounced to ~150ms after the last keystroke
// anywhere in the form so a burst of typing becomes one message, not one per key; a `focusout`
// inside such a form flushes any pending write at once, same as leaving the field would for
// "blur". Whatever the trigger, a commit identical to the last one *this form* sent is dropped
// until a write lands -- typing back to a value on its way, or leaving a field twice, says nothing
// new -- and not after: once an echo or an undo has been drawn, the same value is news again.
function editingChange(form: HTMLFormElement): { doc: string; ops: Op[] } | undefined {
  const ops: Op[] = [];
  let doc: string | undefined;
  const said = new Set<Field>(); // a group of radios is said once
  for (const field of [...form.querySelectorAll("[data-write]")].filter(holdsOne)) {
    if (said.has(field)) continue;
    if (isRadio(field)) for (const r of groupOf(field)) said.add(r);
    if (held(field) === rendered(field)) continue;
    const spec = JSON.parse(field.dataset.write!) as WriteSpec;
    doc = spec.doc;
    if (typed(field)) ops.push({ op: "test", path: spec.path, value: seen.get(field) ?? (rendered(field) as string) });
    ops.push({ op: spec.op, path: spec.path, value: sends(field) });
  }
  return doc && ops.length > 0 ? { doc, ops } : undefined;
}

// The field you are typing in. A drawing that changes it under you shows you nothing --
// the morph keeps what you type -- so a write from it says what it was drawn with when you last
// saw it, as RFC 6902's `test`, and the server refuses it when the field is drawn otherwise now:
// someone changed it since. Refused so, it shows what is drawn. Your own write landing is seen.

/** A field typed in: not a box, a radio or a select, which show what is drawn (morph.ts). */
const typed = (field: Field): boolean => !isBox(field) && !isRadio(field) && !(field instanceof HTMLSelectElement);
/** The editing forms' fields typed in. */
const typedFields = (): Field[] => [...app.querySelectorAll<Field>("form[data-write-on] [data-write]")].filter(typed);
/** What each field typed in was drawn with when its typist last saw it drawn. */
const seen = new WeakMap<Field, string>();
/** A write of yours has landed: the drawing that follows is yours, and seen. */
let yours = false;

/** After a drawing: a field typed in that shows what is drawn, or after a write of yours, is seen. */
function seeDrawn(): void {
  for (const field of typedFields()) if (yours || held(field) === rendered(field)) seen.set(field, rendered(field) as string);
  yours = false;
}

/** A write of yours refused: a field typed in that is drawn otherwise than it was seen shows what is drawn. */
function showDrawn(): void {
  for (const field of typedFields()) {
    const drawn = rendered(field) as string;
    if (drawn === seen.get(field)) continue;
    hold(field, drawn);
    seen.set(field, drawn);
  }
}

/** The editing form of the field `event` is from, if it commits on `trigger`. */
function editing(event: Event, trigger: "blur" | "change" | "input"): HTMLFormElement | undefined {
  const field = event.target;
  const form = field instanceof HTMLElement && field.matches("[data-write]") ? field.closest("form") : null;
  return form?.dataset.writeOn === trigger ? form : undefined;
}

const INPUT_DEBOUNCE_MS = 150;
const inputTimers = new WeakMap<HTMLFormElement, ReturnType<typeof setTimeout>>();
// The ops of the last message *this form* actually sent, until a write lands, so retyping back to
// an already-sent value doesn't repeat it -- keyed by form, not by field, since a commit is
// every changed field in one message (docs/dzql/rendering/bento-request.md K3).
let lastEditSent = new WeakMap<HTMLFormElement, string>();
/** The socket went: the next page sent whole is drawn afresh, and the editing forms then say what it does not show. */
let afresh = false;

function commitEdit(form: HTMLFormElement) {
  const change = editingChange(form);
  if (!change) return;
  const key = JSON.stringify(change.ops);
  if (lastEditSent.get(form) === key) return;
  if (send(change.doc, change.ops)) lastEditSent.set(form, key); // one that did not go goes on the next commit
}

/**
 * Says what the editing form someone is in holds, before a gesture that takes it away (Escape,
 * Back). Leaving a field says it, but a field a render takes out has not been left: Chrome fires
 * focusout as it goes, WebKit (every iPhone browser) does not, and the words would go with it.
 */
function commitFocused() {
  const form = document.activeElement instanceof HTMLElement ? document.activeElement.closest("form") : null;
  if (form?.dataset.writeOn && app.contains(form)) commitNow(form);
}

/** Commits what a form holds now, in place of the commit its typing was waiting to make. */
function commitNow(form: HTMLFormElement) {
  clearTimeout(inputTimers.get(form));
  inputTimers.delete(form);
  commitEdit(form);
}

// `focusout` (bubbles), not `blur` (doesn't): the field-losing-focus trigger, for text-like
// fields typed into. `change` fires on its own for a field that commits immediately (a checkbox,
// a select) as well as a blurred text field, so a form only ever needs one or the other. An
// "input" form also flushes any pending debounced write here, rather than waiting the debounce
// out once the person has already moved on.
app.addEventListener("focusout", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLElement)) return;
  const form = field.closest("form");
  if (form?.dataset.writeOn === "blur" && field.matches("[data-write]")) commitEdit(form);
  else if (form?.dataset.writeOn === "input" && inputTimers.has(form)) commitNow(form);
});
app.addEventListener("change", (event) => {
  const form = editing(event, "change");
  if (form) commitEdit(form);
});
app.addEventListener("input", (event) => {
  const form = editing(event, "input");
  if (!form) return;
  clearTimeout(inputTimers.get(form));
  inputTimers.set(form, setTimeout(() => commitNow(form), INPUT_DEBOUNCE_MS));
});

// A page from another release than its server's -- a tab open over a deploy, or one rolled back --
// is loaded again, so page and server speak one wire (src/json-patch.ts WIRE). Not twice in
// a minute: behind one address, two releases must not keep a tab loading; the page is drawn, and
// the mismatch said. True when it is loading again.
function reloadForWire(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem("eta:reloaded")) > 60_000) {
      sessionStorage.setItem("eta:reloaded", String(Date.now()));
      location.reload();
      return true;
    }
  } catch {
    // no storage to remember it by: never loaded again, rather than perhaps for ever
  }
  console.error("eta: this page and its server speak different wires: load it again");
  return false;
}

// What the connection is doing, said in a status region beside the page, not in it: the page is
// inert while the socket is gone, and what is inert is not read out. Only this is said. A change
// from someone else is drawn in silently: a change speaks to the person who made it
// (docs/dzql/rendering/bento/README.md), and a page that read out everyone's writes would never be quiet.
app.insertAdjacentHTML("afterend", `<p role="status" class="connection"></p>`);
const connection = app.nextElementSibling!;

function connect() {
  socket = new WebSocket(`${location.origin.replace("http", "ws")}/ws`); // http: goes ws:, https: wss:

  // A successful connection means prior turbulence is over: the next drop,
  // whenever it happens, should retry promptly rather than inherit an old backoff.
  socket.addEventListener("open", () => {
    reconnectDelay = RECONNECT_DELAY_MS;
    app.inert = false;
    delete app.dataset.offline;
    connection.textContent = "";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "render") {
      if (message.ops) applyFragments(message.ops);
      else if (message.wire === WIRE || !reloadForWire()) {
        if (sending?.unanswered) handBack(); // the page drawn afresh, after its socket went
        askedAfresh = false;
        render(message.html);
        if (afresh) {
          // and each editing form says, once, what the page does not show: an edit dropped as the
          // socket went, or unanswered; one that landed is drawn, and is not said again
          afresh = false;
          for (const form of app.querySelectorAll<HTMLFormElement>("form[data-write-on]")) commitEdit(form);
        }
      }
    } else if (message.type === "refused") {
      // this page's own write, refused, and why if it says: its form's values are back before the page
      // that follows is drawn, which keeps a choice the page still offers (keepingChoices, morph.ts)
      answered({ id: message.id, refused: true, ...(message.reason !== undefined && { reason: message.reason }) });
    } else if (message.type === "patch") {
      const kept = docs.get(message.doc)?.ops ?? [];
      docs.set(message.doc, { version: message.version, ops: [...kept, ...message.ops].slice(-MAX_OPS_KEPT_PER_DOC) });
      // An applet watching this document takes the ops as its props (or the ops, see Applet.patch):
      // the delta is its update, and no render follows for it.
      for (const [el, held] of mounted) if (el.dataset.doc === message.doc && message.ops.length > 0) watched(el, held, message.version, message.ops);
      // this page's own write, echoed ("yours": the id is its own): it landed
      const { doc, version, ops, change } = message;
      answered({ id: message.id, echoed: true, doc, version, ops, ...(change !== undefined && { change }) });
      if (message.ops.length > 0) lastEditSent = new WeakMap(); // a write landed: what was sent may be said again
    }
  });

  // The connection gone, the page stays as it is -- what is typed, what applets hold -- but is not
  // to be used (src/bento.css says so) until the server, reached again, draws it afresh.
  socket.addEventListener("close", () => {
    // What was on its way is unanswered: no server answers it on another socket. Its form's values go
    // back when the page is drawn afresh (`sending`) -- it may have landed: better there twice than lost.
    if (lastSent && !lastSent.echoed && !lastSent.refused) lastSent.unanswered = true;
    if (sending) sending.unanswered = true;
    for (const id of [...hearing.keys()]) heard(id, { id, unanswered: true });
    lastEditSent = new WeakMap();
    afresh = true;
    app.inert = true;
    app.dataset.offline = "";
    connection.textContent = "Reconnecting…";
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  });
  // a socket's error is always followed by its close
}

connect();
