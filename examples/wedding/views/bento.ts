// The surfaces every page is made of, drawn as the bento mock-up draws them (examples/bento):
// the trail (where am I), the tray and its compartments, the window a compartment grows into,
// the stacks of tools that float in it, the rows of a list, the drawer (a panel at the right from
// 820px, a sheet from the foot on a phone) and its properties, the modal. Every gesture here is a
// write to the session -- going to a page, opening a drawer, switching a reading -- so the kernel
// renders the result.

import { slug, tray, type Compartment, type Tray } from "../../../src/tray";
import { esc, join, nav, write } from "./html";
import { icon, type IconName } from "./icons";

// ───────────────────────────── where am I ─────────────────────────────

export interface Crumb {
  label: string;
  /** The page this crumb is a way back to; the root without one is named but not a page. */
  page?: string;
}

/** The trail from the root to the ground you stand on. The last is where you are; each earlier crumb with a page is a way back. */
export function crumbs(items: Crumb[]): string {
  return `<nav class="crumbs cap" aria-label="Where you are">${items
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

// ───────────────────────────── the tray ─────────────────────────────

export interface CellOptions {
  name: string;
  /** How many are here; it rides in the head beside the name. */
  count?: number | null;
  summary?: string | null;
  /** The page this compartment opens under: › into it. A thing (rule 15) has none and carries ✎ instead. */
  page?: string;
  /** The tray's own name for it, when it differs from `slug(name)` ("the day" opens under "day"). */
  key?: string;
  /** Spans the tray: the one that matters more (rule 5). */
  big?: boolean;
  /** The small reading (rule 4): the family photo, a few lines. */
  body?: string;
  mark?: IconName;
  /** A thing: the write that opens its drawer, and whether the drawer is open (lit while it is). */
  thing?: { open: string; chosen: boolean };
}

/** A compartment as the tray places it: its html, and how much of the tray it asked for. */
export interface Placeable extends Compartment {
  html: string;
}

/** The tray is three across from 820px and one on a phone (styles.css picks); a box computes both. */
const COLUMNS = 3;

/** A compartment, closed: its mark and name, a › because it opens (✎ when it is a thing), a summary, a small reading. */
export function cell(o: CellOptions): Placeable {
  const key = o.key ?? slug(o.name);
  const name = `<span class="cell-name">${esc(o.name)}${o.count != null ? ` · ${o.count}` : ""}</span>`;
  const mark = o.mark ? `<span class="cell-icon">${icon(o.mark, 18)}</span>` : "";
  const chev = o.page !== undefined ? `<span class="chev">${icon("chevron-right", 18)}</span>` : o.thing ? `<span class="chev pencil">${icon("pencil", 16)}</span>` : "";
  const opens = o.page !== undefined ? nav(o.page) : o.thing ? o.thing.open : "";
  // rule 7 (K1): a compartment that opens names itself for the view transition, in the box's
  // render and the open render alike -- one attribute, one element
  const moving = o.page !== undefined ? ` data-moving="${esc(key)}"` : "";
  const thing = o.thing ? ` aria-pressed="${o.thing.chosen}"` : "";
  const html = join(
    `<div class="cell${o.big ? " big" : ""}${o.thing ? " thing" : ""}" data-key="${key}"${moving}${thing}${opens ? ` role="button" tabindex="0"${opens}` : ""}>`,
    `<div class="cell-head cap">${mark}${name}${chev}</div>`,
    o.summary && `<p class="cell-summary">${esc(o.summary)}</p>`,
    o.body && `<div class="cell-body">${o.body}</div>`,
    "</div>",
  );
  return { key, span: o.big ? COLUMNS : 1, rows: 1, html };
}

/** What grows into the window when a compartment opens (rules 7, 8): its reading, its tools on the rail, a note. */
export interface OpenOptions {
  /** The key of the compartment that grows: `cell()`'s own. */
  key: string;
  /** The reading switch, a stack of its own at the top of the rail (rule 16). */
  reading?: string;
  /** The compartment's other tools -- find, plus -- one stack beneath it. */
  tools?: string[];
  /** Find's field, open beside its tool (rule 17). */
  filter?: string;
  /** The reading itself; a picture, or rows. */
  body: string;
  note?: string | null;
}

/**
 * A page that is a box: the trail and the page's tools above, the ground's own in place, the
 * compartments in the tray -- or, when `open` names one, that compartment grown into the window
 * (rule 7: the same element, `data-moving`, bigger), with its trail floating top-left, its rail
 * at the right and the page's tools at the bottom right (rule 9). The tray is computed
 * (src/tray.ts): each compartment lands in its area, first-fit in the box's own order, and learns
 * which of the tray's corners it sits in, for three columns and for one.
 */
export function boxPage(trail: Crumb[], inPlace: string[], cells: Placeable[], open?: OpenOptions): string {
  const wide = tray(cells, COLUMNS);
  const narrow = tray(cells, 1);
  const cornersOf = (t: Tray, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
  const placed = cells.map((c) => {
    if (open && c.key === open.key) return windowOf(trail, open);
    return c.html.replace(
      `data-key="${c.key}"`,
      `data-key="${c.key}" data-corners="${cornersOf(wide, c.key)}" data-corners-phone="${cornersOf(narrow, c.key)}" style="grid-area: ${c.key}"`,
    );
  });
  const areas = (t: Tray): string => t.areas.replace(/\n/g, " ");
  return join(
    `<header class="page-head">${crumbs(trail)}${open ? "" : pageTools("across")}</header>`,
    `<section class="page box${open ? " windowed" : ""}">`,
    ...inPlace,
    `<div class="cells" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}</div>`,
    "</section>",
  );
}

/** The window: the compartment open. Its head is the trail's last two crumbs, the way back and the name. */
function windowOf(trail: Crumb[], open: OpenOptions): string {
  const here = trail[trail.length - 1]!;
  const back = trail.length > 1 ? trail[trail.length - 2] : undefined;
  const head = join(
    `<div class="cell-head cap">`,
    back && back.page !== undefined && `<a class="cell-back" href="#"${nav(back.page)}>${esc(back.label)}</a><span class="chev">${icon("chevron-right", 14)}</span>`,
    `<span class="cell-name">${esc(here.label)}</span></div>`,
  );
  const rail = join(
    `<div class="rail work">`,
    open.reading,
    open.tools && open.tools.length > 0 && `<div class="stack">${open.tools.join("")}</div>`,
    "</div>",
  );
  return join(
    `<div class="cell open" data-key="${open.key}" data-moving="${esc(open.key)}">`,
    head,
    rail,
    open.filter,
    `<div class="full">${open.body}${open.note ? `<p class="note">${esc(open.note)}</p>` : ""}</div>`,
    pageTools(),
    "</div>",
  );
}

// ───────────────────────────── the tools ─────────────────────────────

export interface ToolOptions {
  icon?: IconName;
  /** `add` is burgundy; `quiet` is plain ink (Cancel, Leave); `danger` is a removal. */
  kind?: "add" | "quiet" | "danger";
  /** The write attributes (see html.ts's write()). */
  write: string;
  label?: string;
  /** In a stack (rule 9): a square button, the word for a screen reader only. */
  iconOnly?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  submit?: boolean;
}

/** A verb: a button with a word, or in a stack, a square button with an icon. */
export function tool(text: string, o: ToolOptions): string {
  const word = o.iconOnly ? `<span class="sr-only">${esc(text)}</span>` : esc(text);
  const label = o.label ?? (o.iconOnly ? text : undefined); // a square button says its word to a screen reader
  const pressed = o.pressed === undefined ? "" : ` aria-pressed="${o.pressed}"`;
  return `<button type="${o.submit ? "submit" : "button"}" class="tool${o.kind ? ` ${o.kind}` : ""}"${label ? ` aria-label="${esc(label)}"` : ""}${pressed}${o.disabled ? " disabled" : ""}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
}

/** Undo: a write to the ledger, the kernel's own document, the same on every page. */
export const undoTool = (): string => tool("Undo", { icon: "undo", write: write("ledger", "remove", "/latest"), iconOnly: true });
/** Redo: the undo walked forward again. */
export const redoTool = (): string => tool("Redo", { icon: "redo", write: write("ledger", "add", "/latest"), iconOnly: true });
/** Leave: set apart by a rule; the session forgets its code. */
export const leaveTool = (): string => tool("Leave", { icon: "log-out", kind: "quiet", write: write("session", "remove", "/code"), iconOnly: true });

/** The page's own tools, undo, redo and leave: one stack, at the bottom right of the window, or across beside the trail on the box (rule 9). */
export function pageTools(lay: "down" | "across" = "down"): string {
  return `<div class="stack page-tools${lay === "across" ? " across" : ""}" aria-label="Tools">${undoTool()}${redoTool()}${leaveTool()}</div>`;
}

/** The reading switch (rule 16): the same figures drawn another way, the current one pressed. A stack of its own. */
export function readingSwitch(key: string, current: string, options: string[]): string {
  const mark = (value: string): IconName => (value === "photo" ? "camera" : value === "grid" ? "grid" : "list");
  return `<div class="stack" role="radiogroup" aria-label="Read as">${options
    .map((value) => `<button type="button" class="tool" role="radio" aria-checked="${current === value}" aria-pressed="${current === value}" aria-label="${esc(value)}"${write("session", "replace", `/reading/${key}`, value)}>${icon(mark(value))}<span class="sr-only">${esc(value)}</span></button>`)
    .join("")}</div>`;
}

/** The plus on a collection's rail: opens the modal that adds to `collection` (session `/new`). */
export const addTool = (collection: string, label: string): string =>
  tool(label, { icon: "plus", write: write("session", "replace", "/new", collection), iconOnly: true, label });

export interface FindState {
  /** The word, once find is open; undefined while it is closed. */
  word?: string;
  /** The eye: hide what the word misses instead of dimming it. */
  hide?: boolean;
  shown: number;
  total: number;
}

/**
 * Find (rule 17): on the rail, a tool pressed while it is open; open, a field beside the rail
 * writing the word as it is typed (K3), the eye that hides what misses instead of dimming it, and
 * the tally of how many of all the word hits. Closing forgets the word and the eye.
 */
export function findControl(key: string, f: FindState): { tool: string; filter?: string } {
  const open = f.word !== undefined;
  const button = tool("Find", {
    icon: "search",
    iconOnly: true,
    pressed: open,
    write: open ? write("session", "remove", `/filter/${key}`) : write("session", "replace", `/filter/${key}`, ""),
  });
  if (!open) return { tool: button };
  const eye = tool(f.hide ? "Show what misses" : "Hide what misses", {
    icon: f.hide ? "eye-off" : "eye",
    iconOnly: true,
    pressed: !!f.hide,
    write: f.hide ? write("session", "remove", `/hide/${key}`) : write("session", "replace", `/hide/${key}`, true),
  });
  const filter = join(
    `<div class="filter">`,
    `<form data-write-on="input"><input name="q" type="search" value="${esc(f.word)}" placeholder="Find" aria-label="Find" autocomplete="off" autofocus${write("session", "replace", `/filter/${key}`)}></form>`,
    `<span class="tally">${f.shown} of ${f.total}</span>`,
    eye,
    "</div>",
  );
  return { tool: button, filter };
}

// ───────────────────────────── the rows ─────────────────────────────

export interface RowOptions {
  id?: string;
  /** What a tap writes: the row's drawer, or the page it goes into. A row without one is read only. */
  tap?: string;
  /** Lit across its whole line while its drawer is open (rule 13), and scrolled into the clear (K2). */
  chosen?: boolean;
  /** Find's word missed it (rule 17): dimmed, or with the eye, hidden. */
  hushed?: boolean;
  hidden?: boolean;
  /** What leads the line: a picture, a time. */
  lead?: string;
  what: string;
  note?: string | null;
  /** The state, at the right in small caps: coming, open, claimed by us. */
  state?: string;
  /** What the tap does, at the end of the line: ✎ its drawer, › into it. */
  mark?: "pencil" | "chevron";
}

/** A row of a list: one line per thing, the same columns on every list -- a lead, the words, the state, the mark. */
export function row(o: RowOptions): string {
  const classes = ["row", o.tap && "tap", o.hushed && "hushed"].filter(Boolean).join(" ");
  const attrs = join(
    o.id && ` id="${esc(o.id)}"`,
    o.tap && ` role="button" tabindex="0"${o.tap}`,
    o.chosen !== undefined && ` aria-pressed="${o.chosen}"`,
    o.chosen && " data-reveal",
    o.hidden && " hidden",
  );
  const mark = o.mark === "pencil" ? `<span class="mark">${icon("pencil", 16)}</span>` : o.mark === "chevron" ? `<span class="mark">${icon("chevron-right", 18)}</span>` : "";
  return join(
    `<div class="${classes}"${attrs}>`,
    o.lead && `<span class="lead">${o.lead}</span>`,
    `<span class="words"><span class="what">${esc(o.what)}</span>${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}</span>`,
    o.state && `<span class="state">${o.state}</span>`,
    mark,
    "</div>",
  );
}

/** A list: its rows, and nothing when there are none but the note that says so. */
export const rows = (items: string[], empty: string): string => (items.length ? `<div class="rows">${items.join("")}</div>` : `<p class="note">${esc(empty)}</p>`);

// ───────────────────────────── the drawer ─────────────────────────────

/** A property in a drawer: its name, and its value or the control that sets it. */
export const prop = (name: string, value: string): string => `<div class="prop"><span class="prop-name cap">${esc(name)}</span><div class="prop-value">${value}</div></div>`;

export interface Option {
  text: string;
  on: boolean;
  write: string;
  kind?: "yes" | "no";
}

/** One choice among a few: every option shown, the current one filled. `locked` after a deadline. */
export function choice(label: string, options: Option[], locked = false): string {
  return `<div class="pick" role="radiogroup" aria-label="${esc(label)}">${options
    .map((o) => `<button type="button" class="tool${o.kind ? ` ${o.kind}` : ""}" role="radio" aria-checked="${o.on}" aria-pressed="${o.on}"${o.write}${locked ? " disabled" : ""}>${esc(o.text)}</button>`)
    .join("")}</div>`;
}

/**
 * A sheet: a panel docked at the right from 820px, a drawer rising from the foot on a phone,
 * over a scrim that closes it. Rendered whenever the session says it is open; `close` is the
 * write that closes it. The body keeps its own scroll across renders because the morph keeps
 * the element.
 */
export function sheet(id: string, title: string, body: string, close: string, className = ""): string {
  return join(
    `<div class="scrim"${close}></div>`,
    `<div id="${esc(id)}" class="sheet${className ? ` ${className}` : ""}" role="dialog" aria-label="${esc(title)}">`,
    `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="tool quiet sheet-close" aria-label="Close"${close}>${icon("x", 18)}</button></div>`,
    `<div class="sheet-body">${body}</div>`,
    "</div>",
  );
}

// ───────────────────────────── the modal ─────────────────────────────

/**
 * A modal: new or delete, one question, nothing else (rule 14). Not `<dialog>.showModal()` --
 * the kernel's client learns no such call, the shape is HTML -- so it carries its own scrim, the
 * way a sheet does, and the page behind it is put `inert` by the caller.
 */
function modalShell(title: string, close: string, body: string): string {
  return join(
    `<div class="scrim modal-scrim"${close}></div>`,
    `<dialog open class="modal" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}</dialog>`,
  );
}

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "number";
  required?: boolean;
  value?: string;
}

/** Adding a thing is the plus and a modal asking for it -- its name, or the few fields it needs. `add` is the form's write. */
export function addModal(title: string, fields: Field[], add: string, verb = "Add"): string {
  const close = write("session", "remove", "/new");
  const inputs = fields
    .map(
      (f, i) =>
        `<label class="modal-field"><span class="note">${esc(f.label)}</span><input name="${esc(f.name)}" type="${f.type ?? "text"}"${f.type === "number" ? ' min="0"' : ""} value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder ?? "")}" autocomplete="off"${f.required === false ? "" : " required"}${i === 0 ? " autofocus" : ""}></label>`,
    )
    .join("");
  const body = join(
    `<form${add}>${inputs}`,
    `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool(verb, { icon: "plus", kind: "add", write: "", submit: true })}</div>`,
    "</form>",
  );
  return modalShell(title, close, body);
}

/** Removing a thing asks in a modal too -- a modal is new or delete and nothing else (rule 14). */
export function confirmModal(title: string, question: string, destroy: string): string {
  const close = write("session", "remove", "/confirm");
  const body = join(
    `<p class="note">${esc(question)}</p>`,
    `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool("Remove", { icon: "trash", kind: "danger", write: destroy })}</div>`,
  );
  return modalShell(title, close, body);
}
