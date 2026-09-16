// The surfaces every page is made of: the breadcrumb (where am I), the box and its compartments,
// the collection page and its tools, the sheet (a drawer from the foot on a phone, a panel at the
// right from 820px), and the tools. Every gesture here is a write to the session -- going to a
// page, opening or closing a drawer, switching a reading -- so the kernel renders the result.

import { slug, tray, type Compartment, type Tray } from "../../../src/tray";
import { esc, join, nav, write } from "./html";
import { icon, type IconName } from "./icons";

export interface Crumb {
  label: string;
  /** The page this crumb is a way back to; the root without one is named but not a page. */
  page?: string;
}

/** The trail from the root to the ground you stand on. The last is where you are; each earlier crumb with a page is a way back. */
export function crumbs(items: Crumb[]): string {
  return `<nav class="crumbs" aria-label="Where you are">${items
    .map((it, i) => {
      const last = i === items.length - 1;
      const sep = i ? `<span class="sep">${icon("chevron-right", 14)}<span class="sr-only">›</span></span>` : "";
      const label = last
        ? `<b aria-current="page">${esc(it.label)}</b>`
        : it.page !== undefined
          ? `<a href="#"${nav(it.page)}>${esc(it.label)}</a>`
          : `<span class="root">${esc(it.label)}</span>`;
      return `<span class="crumb">${sep}${label}</span>`;
    })
    .join("")}</nav>`;
}

export interface CellOptions {
  name: string;
  /** How many are here; on a small compartment it leads the summary, on a big one it rides in the head. */
  count?: number | null;
  summary?: string | null;
  /** The page below: › into it. A compartment that holds its collection whole has none. */
  page?: string;
  /** The page value this compartment opens under, when it differs from `slug(name)` (rule 7's
   * `data-moving`, and W3's open-in-place, key off this -- the page's own meaning never changed,
   * so a compartment whose label reads differently from its page ("the day" is page "day") says so here). */
  key?: string;
  big?: boolean;
  body?: string;
  mark?: IconName;
  /** Tools the compartment offers on its own body: its collection's reading switch. */
  tools?: string;
}

/** A compartment as the tray places it: its html, and how much of the tray it asked for. */
export interface Placeable extends Compartment {
  html: string;
}

/** The tray is three across from 820px and one on a phone (styles.css picks); a box computes both. */
const COLUMNS = 3;

/** A compartment: one thing on the ground, showing the state it is in, › into its page. A big one spans the tray. */
export function cell(o: CellOptions): Placeable {
  const countInHead = o.big && o.count != null;
  const counted = (o.summary ?? "").startsWith(`${o.count}`); // a summary that already counts ("3 events") is not counted twice
  const summary = !o.big && o.count != null && !counted ? `${o.count}${o.summary ? ` · ${o.summary}` : ""}` : o.summary;
  const name = `<span class="cell-name">${esc(countInHead ? `${o.name} · ${o.count}` : o.name)}</span>`;
  const mark = o.mark ? `<span class="cell-icon">${icon(o.mark)}</span>` : "";
  const head =
    o.page !== undefined
      ? `<a class="cell-head" href="#"${nav(o.page)}>${mark}${name}<span class="chev">${icon("chevron-right", 18)}</span></a>`
      : `<div class="cell-head">${mark}${name}</div>`;
  // the tray's own grid-area identity, and the page value this compartment opens under (K1's
  // `data-moving`, and W3's `boxPage` `open` param key) are the same thing -- `o.key` overrides
  // `slug(name)` only when a compartment's label reads differently from its page ("the day" is
  // page "day"), so the two never drift apart.
  const key = o.key ?? slug(o.name);
  // rule 7's K1: a navigable compartment names itself for the view transition, in both the box's
  // own render and the open render (boxPage's `open` param) -- one attribute, one element.
  const moving = o.page !== undefined ? ` data-moving="${esc(key)}"` : "";
  const html = join(
    `<div class="cell${o.big ? " big" : ""}${o.page === undefined ? " whole" : ""}" data-key="${key}"${moving}${o.page !== undefined ? nav(o.page) : ""}>`,
    head,
    o.tools && `<div class="cell-tools">${o.tools}</div>`,
    o.body && `<div class="cell-body">${o.body}</div>`,
    summary && `<p class="cell-summary">${esc(summary)}</p>`,
    "</div>",
  );
  return { key, span: o.big ? COLUMNS : 1, rows: 1, html };
}

/** What grows into the window when a compartment opens (rules 7, 8): its own tools on the rail,
 * the reading, a note. `key` is the page value it opens under -- the same key `cell()`'s own
 * `data-moving` used before the write that opened it, so K1 finds the one element that grows. */
export interface OpenOptions {
  key: string;
  tools?: string[];
  body: string;
  note?: string | null;
}

/**
 * A page that is a box: the crumbs, the ground's own in place, the compartments in the tray, the
 * tools at the foot -- or, when `open` names one, that compartment grown into the window in its
 * own place in the tray (rule 7: the same element, `data-moving`, just bigger) with the others
 * gone behind it (rule 8: whatever it holds, a map, a photo, a grid or a list, opens the same
 * way), its own reading scrolling under its rail and the page's tools (rule 10). The tray is
 * computed (src/tray.ts), not drawn: each compartment lands in its area, first-fit in the box's
 * own order, and learns which of the tray's corners it sits in, once for three columns and once
 * for one -- the stylesheet picks by width.
 *
 * W5.3: the page's tools, and the open compartment's own rail, are the window's own furniture,
 * not the screen's -- both are rendered *inside* the element they float over (`.cells` when
 * nothing is open, the open `.cell` itself when one is), so `position: absolute` from 820px
 * anchors them to that element's own box, not the viewport (the stylesheet still lets them stay
 * `position: fixed` to the screen's corner on a phone, where the DOM nesting makes no difference).
 */
export function boxPage(trail: Crumb[], inPlace: string[], cells: Placeable[], open?: OpenOptions, extra: string[] = []): string {
  const wide = tray(cells, COLUMNS);
  const narrow = tray(cells, 1);
  const cornersOf = (t: Tray, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
  const placed = cells.map((c) => {
    if (open && c.key === open.key) {
      // no `grid-area` here (unlike the closed cells below): open, this cell is `position:
      // absolute; inset: 0` to `.cells` (W5.1), and a grid item's own named area still bounds an
      // absolutely positioned box even with insets given, so naming one would shrink it back to
      // its closed slot instead of the tray's own rectangle.
      return join(
        `<div class="cell open" data-key="${c.key}" data-moving="${esc(open.key)}">`,
        `<div class="cell-open-body">${open.body}</div>`,
        open.note && `<p class="note">${esc(open.note)}</p>`,
        open.tools && open.tools.length > 0 && `<div class="rail work">${open.tools.join("")}</div>`,
        pageTools(),
        "</div>",
      );
    }
    return c.html.replace(
      `data-key="${c.key}"`,
      `data-key="${c.key}" data-corners="${cornersOf(wide, c.key)}" data-corners-phone="${cornersOf(narrow, c.key)}" style="grid-area: ${c.key}"`,
    );
  });
  const areas = (t: Tray): string => t.areas.replace(/\n/g, " ");
  const shown = extra.filter(Boolean);
  return join(
    crumbs(trail),
    `<section class="page box">`,
    ...(open ? [] : inPlace),
    `<div class="cells${open ? " has-open" : ""}" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}${open ? "" : pageTools()}</div>`,
    !open && shown.length > 0 && `<div class="foot-tools">${shown.join("")}</div>`,
    "</section>",
  );
}

/** The reading switch, a tool on a collection: the same figures drawn another way -- the photo or the list. */
export function readingSwitch(key: string, current: string, options: string[]): string {
  return `<div class="seg" role="radiogroup" aria-label="Read as">${options
    .map(
      (value) =>
        `<button type="button" class="seg-opt${current === value ? " on" : ""}" role="radio" aria-checked="${current === value}"${write("session", "replace", `/reading/${key}`, value)}>${icon(value === "photo" ? "camera" : "list")}${esc(value)}</button>`,
    )
    .join("")}</div>`;
}

/**
 * Find, a tool on a collection's rail (rule 17): closed, the plus on the rail opens the field
 * (a session write of `/filter/<key>` to `""`); open, the field itself (`data-write-on="input"`,
 * K3) beside a close button that removes the key -- never a toggle button once it is open, since
 * closing has to forget the word, not merely clear it.
 */
export function findControl(key: string, current: string | undefined): string {
  if (current === undefined) return tool("Find", { icon: "search", kind: "quiet", write: write("session", "replace", `/filter/${key}`, ""), iconOnly: true, label: "Find" });
  return join(
    `<form class="find-form" data-write-on="input">`,
    `<input class="field" name="q" value="${esc(current)}" placeholder="Find" aria-label="Find" autocomplete="off" autofocus${write("session", "replace", `/filter/${key}`)}>`,
    `<button type="button" class="ghost small" aria-label="Close find"${write("session", "remove", `/filter/${key}`)}>${icon("x", 15)}</button>`,
    "</form>",
  );
}

export interface ToolOptions {
  icon?: IconName;
  /** `add` is burgundy; `quiet` sits at the right in plain ink (Leave); `danger` is a removal. */
  kind?: "add" | "quiet" | "danger";
  /** The write attributes (see html.ts's write()). */
  write: string;
  label?: string;
  /** In a stack of square icon buttons (rule 9's Leaflet-style control), the word is for a screen reader only. */
  iconOnly?: boolean;
}

/** A verb a page or a compartment offers. */
export function tool(text: string, o: ToolOptions): string {
  const word = o.iconOnly ? `<span class="sr-only">${esc(text)}</span>` : esc(text);
  return `<button type="button" class="tool${o.kind ? ` ${o.kind}` : ""}"${o.label ? ` aria-label="${esc(o.label)}"` : ""}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
}

/** Undo: a write to the ledger, the kernel's own document, the same on every page. */
export function undoTool(): string {
  return tool("Undo", { icon: "undo", kind: "quiet", write: write("ledger", "remove", "/latest"), iconOnly: true });
}

/** Redo: the undo walked forward again. */
export function redoTool(): string {
  return tool("Redo", { icon: "redo", kind: "quiet", write: write("ledger", "add", "/latest"), iconOnly: true });
}

/** Leave: quiet at the right of the foot; the session forgets its code. */
export function leaveTool(): string {
  return tool("Leave", { icon: "log-out", kind: "quiet", write: write("session", "remove", "/code"), iconOnly: true });
}

/**
 * The page's own tools -- undo, redo, leave -- rule 9: one more stack, floating at the bottom
 * right of the tray or the window, over the compartments. Leave sits apart, behind a rule
 * (drawn like the mock-up's `.stack`, a Leaflet-style control). Every box and collection page
 * carries it; no call site builds this trio by hand any more.
 */
export function pageTools(): string {
  return `<div class="stack page-tools">${undoTool()}${redoTool()}${leaveTool()}</div>`;
}

/**
 * A sheet: a drawer rising from the foot on a phone, a property panel docked at the right from
 * 820px, over a scrim that closes it. Rendered whenever the session says it is open; `close` is
 * the write that closes it. The body keeps its own scroll across renders because the morph keeps
 * the element.
 */
export function sheet(id: string, title: string, body: string, close: string, className = ""): string {
  return join(
    `<div class="scrim"${close}></div>`,
    `<div id="${esc(id)}" class="sheet${className ? ` ${className}` : ""}" role="dialog" aria-label="${esc(title)}">`,
    `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="sheet-close"${close}>Close</button></div>`,
    `<div class="sheet-body">${body}</div>`,
    "</div>",
  );
}

/**
 * A modal: new or delete, one question, nothing else (rule 14). Not `<dialog>.showModal()` --
 * the kernel's client learns no such call, the shape is HTML -- so it carries its own scrim, the
 * way a sheet does, and the page behind it is put `inert` by the caller, since dimming alone
 * would still let a keyboard or a screen reader reach through it.
 */
function modalShell(title: string, close: string, body: string): string {
  return join(
    `<div class="scrim modal-scrim"${close}></div>`,
    `<dialog open class="modal" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}</dialog>`,
  );
}

/** The plus on a collection's rail: opens the add-modal for `collection` (session `/new`). */
export function addTool(collection: string, label: string): string {
  return tool(label, { icon: "plus", kind: "add", write: write("session", "replace", "/new", collection), iconOnly: true, label });
}

/**
 * Adding a thing -- a guest, a gift, an ask, an event -- is the plus on a collection's rail and a
 * modal asking one question, the name (rule 14). `add` is the write for the form's own field
 * (its `path` ending `/-`); the field's name is always `name`. The caller only calls this when
 * the session says the modal is open (the same shape as `sheet()` -- a `""` otherwise).
 */
export function addModal(title: string, noun: string, add: string): string {
  const close = write("session", "remove", "/new");
  const body = join(
    `<form class="modal-field"${add}>`,
    `<input class="field" name="name" placeholder="${esc(`The ${noun}'s name`)}" aria-label="${esc(`The ${noun}'s name`)}" autocomplete="off" required autofocus>`,
    `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}<button type="submit" class="tool add">${icon("plus")}Add</button></div>`,
    "</form>",
  );
  return modalShell(title, close, body);
}

/** Removing a thing asks in a modal too -- a modal is new or delete and nothing else (rule 14). */
export function confirmModal(title: string, question: string, destroy: string): string {
  const close = write("session", "remove", "/confirm");
  const body = join(
    `<p class="note">${esc(question)}</p>`,
    `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}<button type="button" class="tool danger"${destroy}>${icon("trash")}Remove</button></div>`,
  );
  return modalShell(title, close, body);
}
