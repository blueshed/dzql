// The surfaces a page that is a box is made of, one way to draw the bento (docs/dzql/rendering/bento/README.md), a default an app may change: the trail (where am I), the tray and its cells, the window a
// cell grows into, the stacks of tools that float in it, the rows of a list, the drawer (a
// panel at the right from 820px, a sheet from the foot on a phone) and its properties, the modal.
// `src/bento.css` is their look, in an example's own tokens. No example knowledge here: an example
// binds this once to its own icons and to the document its page's state is written to
// (`bento({icon, session})`), and every gesture is then a `data-write` the caller hands in, or one to
// that document at the paths `patchCollections` below applies.

import { esc, join, write } from "./html";
import { part } from "./parts";
import type { PatchOp } from "./json-patch";
import { splitPath } from "@blueshed/delta/core";
import { slug, grid, type Cell, type Grid } from "./grid";

/** The marks the surfaces draw themselves, by the names an example's icons must know them by. */
export type BentoIcon = "chevron-right" | "pencil" | "x" | "undo" | "redo" | "plus" | "trash" | "search" | "eye" | "eye-off";

export interface BentoOptions<I extends string> {
  /** The example's own icons. A method, so its names may be fewer than `BentoIcon`: an example
   * brings only the marks the surfaces it uses draw (chat: the chevron, undo, redo), and its own
   * render tests are what say so if one is missing. */
  icon(name: I | BentoIcon, size?: number): string;
  /** The docType the page's state is written to, the session: chat's and the wedding's `session`, the ticker's `desk`. */
  session: string;
  /** Leaving, the last of the page's tools, set apart by a rule: removes `path` from the session. Without one (the ticker: nobody signed in) there is only undo and redo. */
  leave?: { text: string; icon: NoInfer<I> | BentoIcon; path: string };
}

export interface Crumb {
  label: string;
  /** The write that goes back to this crumb; the root without one is named but not a place. */
  back?: string;
}

export interface CellOptions<I extends string> {
  name: string;
  /** How many are here; it rides in the head beside the name. */
  count?: number | string | null;
  summary?: string | null;
  /** The write that opens it into the window: › into it. A thing has none and carries ✎ instead. */
  opens?: string;
  /** Its key, when it differs from `slug(name)` ("the day" opens under "day"). */
  key?: string;
  /** Spans the tray: the one that matters more. */
  big?: boolean;
  /** Columns it spans when it is not big. Default 1. */
  span?: number;
  /** The small reading: the family photo, a few lines. */
  body?: string;
  mark?: I | BentoIcon;
  /** A thing: the write that opens its drawer, and whether the drawer is open (lit while it is). */
  thing?: { open: string; chosen: boolean };
}

/** A cell as the tray places it: its html, and how much of the tray it asked for. */
export interface Placeable extends Cell {
  html: string;
  /** Its name, for the window's trail when it opens. */
  name?: string;
}

/** What grows into the window when a cell opens: its reading, its tools on the rail, a note. */
export interface OpenOptions {
  /** The key of the cell that grows: `cell()`'s own. */
  key: string;
  /** The reading switch, a stack of its own at the top of the rail. */
  reading?: string;
  /** The cell's other tools -- find, plus -- one stack beneath it. */
  tools?: string[];
  /** Find's field, open beside its tool. */
  filter?: string;
  /** The reading itself; a picture, or rows. */
  body: string;
  note?: string | null;
}

export interface ToolOptions<I extends string> {
  icon?: I | BentoIcon;
  /** `add` is the accent of making; `quiet` is plain ink (Cancel, Leave); `danger` is a removal. */
  kind?: "add" | "quiet" | "danger";
  /** The write attributes (src/html.ts's write()). */
  write: string;
  label?: string;
  /** In a stack: a square button, the word for a screen reader only. */
  iconOnly?: boolean;
  /** A toggle, and whether it is on: find, the eye. */
  pressed?: boolean;
  /** What opens a drawer, and whether it is open: the tool is drawn lit, and a screen reader hears it expanded. */
  expanded?: boolean;
  disabled?: boolean;
  submit?: boolean;
  /** A class of its own beside `tool` and the kind: find's anchor (`.find`). */
  className?: string;
}

export interface FindState {
  /** The word, once find is open; undefined while it is closed. */
  word?: string;
  /** The eye: hide what the word misses instead of dimming it. */
  hide?: boolean;
  shown: number;
  total: number;
}

export interface RowOptions {
  id?: string;
  /** What a tap writes: the row's drawer, or the page it goes into. A row without one is read only. */
  tap?: string;
  /** Lit across its whole line while its drawer is open, and scrolled into the clear (K2); a screen reader hears it expanded. */
  chosen?: boolean;
  /** Find's word missed it: dimmed, or with the eye, hidden. */
  hushed?: boolean;
  hidden?: boolean;
  /** What leads the line, as HTML: a picture, a time. */
  lead?: string;
  what: string;
  note?: string | null;
  /** The state, at the right in small caps, as HTML: coming, open, claimed by us. */
  state?: string;
  /** What the tap does, at the end of the line: ✎ its drawer, › into it. */
  mark?: "pencil" | "chevron";
}

export interface Option {
  text: string;
  on: boolean;
  write: string;
  kind?: "yes" | "no";
}

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "number" | "date" | "url";
  /** Given, the field is chosen, not typed: a select of these, `value` the one drawn chosen, else the first. */
  options?: { value: string; text: string }[];
  required?: boolean;
  value?: string;
}

/** The tray is three across from 820px and one on a phone (bento.css picks); a box computes both. */
const COLUMNS = 3;

/** Whether find's word hits `text`; no word, or a blank one, hits everything. */
export const matches = (text: string, word: string | undefined): boolean => !word?.trim() || text.toLowerCase().includes(word.trim().toLowerCase());

/** A list: its rows, and nothing when there are none but the note that says so. Given a `key`, the list is a part of its own, so a row coming or going is sent alone. */
export const rows = (items: string[], empty: string, key?: string): string => {
  const html = items.length ? `<div class="rows">${items.join("")}</div>` : `<p class="note">${esc(empty)}</p>`;
  return key ? part(key, html) : html;
};

/** A property in a drawer: its name, and its value or the control that sets it. */
export const prop = (name: string, value: string): string => `<div class="prop"><span class="prop-name cap">${esc(name)}</span><div class="prop-value">${value}</div></div>`;

/** What a field holds, and so how it is drawn and when it writes. */
export type FieldKind = "text" | "textarea" | "number" | "date" | "email" | "select" | "checkbox";

export interface FieldOptions {
  /** The document it writes, as the page names it: "board", "room:general". */
  doc: string;
  /** The JSON Pointer it replaces: "/households/2/email". Its last segment is the field's name. */
  path: string;
  /** What the page read there: drawn into it, so what its write tests when typed over (the field you are typing in). */
  value: string | number | boolean | null | undefined;
  /** Its name in words, its `<label>`: seen beside it, or in a row only heard. */
  label: string;
  /** Text by default. */
  kind?: FieldKind;
  /** A select's choices: the one whose value is `value` is drawn chosen. */
  options?: { value: string; text: string }[];
  placeholder?: string;
  /** When it writes. By its kind: what is typed as it is left; a date, a choice or a tick as it is made. "input" is for a reading drawn as it is typed (find's word): debounced. */
  on?: "blur" | "change" | "input";
  /** The permit's answer for this person: no, and it is read, not a control. */
  may?: boolean;
  /** What this person was told at it (src/refusal.ts `toldAt`), drawn beside it as the status it is described by. Without it, there is none. */
  said?: string;
  /** One of a row's own (a dish's name beside its marks): its label heard, not seen, and laid out as the row lays it out. */
  inRow?: boolean;
}

/** The kinds that write as they are chosen, not as they are left. */
const CHOSEN = new Set<FieldKind>(["date", "select", "checkbox"]);

/**
 * A field that edits one value of a document in place, in one call: its own form that writes on
 * the right trigger (`data-write-on`), the control named by its path's last segment and writing
 * that path, its label tied to it (`for`), the value drawn into it (what a write typed over tests,
 * so a change from someone else is not written over unseen), a status beside it when one is given
 * (`aria-describedby`), and read, not a control, where the permit says no. Drawn as a property (a
 * drawer's), or `inRow`. Nothing is bound, so it is a plain export. A default an app may skip: a
 * form of its own with `data-write-on` and `write()` on its fields is the same wire.
 */
export function field(o: FieldOptions): string {
  const kind = o.kind ?? "text";
  const id = `field-${o.doc}${o.path}`.replace(/[^\w-]/g, "-");
  if (o.may === false) {
    const read = kind === "select" ? o.options?.find((c) => c.value === String(o.value ?? ""))?.text : kind === "checkbox" ? (o.value ? "Yes" : "No") : o.value;
    return o.inRow ? `<span class="field">${esc(read)}</span>` : prop(o.label, esc(read));
  }
  const name = o.path.slice(o.path.lastIndexOf("/") + 1);
  const said = o.said === undefined ? "" : ` aria-describedby="${id}-said"`;
  const attrs = ` id="${id}" name="${esc(name)}"${write(o.doc, "replace", o.path)}${said}`;
  const hint = o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : "";
  const control =
    kind === "textarea" ? `<textarea class="field"${attrs}${hint} rows="3">\n${esc(o.value)}</textarea>` // the first newline is the parser's to drop, so the value's own survives
    : kind === "select" ? `<select class="field"${attrs}>${(o.options ?? []).map((c) => `<option value="${esc(c.value)}"${c.value === String(o.value ?? "") ? " selected" : ""}>${esc(c.text)}</option>`).join("")}</select>`
    : kind === "checkbox" ? `<input${attrs} type="checkbox"${o.value ? " checked" : ""}>`
    : `<input class="field"${attrs} type="${kind}"${kind === "number" ? ' step="any"' : ""} value="${esc(o.value)}"${hint} autocomplete="off">`;
  const status = o.said === undefined ? "" : `<div class="field-said" id="${id}-said">${o.said}</div>`;
  const on = ` data-write-on="${o.on ?? (CHOSEN.has(kind) ? "change" : "blur")}"`;
  const label = `<label class="${o.inRow ? "sr-only" : "prop-name cap"}" for="${id}">${esc(o.label)}</label>`;
  return o.inRow ? `<form class="in-row"${on}>${label}${control}${status}</form>` : `<form class="prop"${on}>${label}<div class="prop-value">${control}${status}</div></form>`;
}

/** One choice among a few: every option shown, the current one filled. `locked` after a deadline. */
export function choice(label: string, options: Option[], locked = false): string {
  return `<div class="pick" role="radiogroup" aria-label="${esc(label)}">${options
    .map((o) => `<button type="button" class="tool${o.kind ? ` ${o.kind}` : ""}" role="radio" aria-checked="${o.on}"${o.write}${locked ? " disabled" : ""}>${esc(o.text)}</button>`)
    .join("")}</div>`;
}

/**
 * A page with what may open over it: the ground -- the page, and the drawer's layer over it -- and
 * the modal's layer. Each layer is always there, empty when nothing is open, so opening or closing
 * a drawer or a modal sends that layer alone (src/parts.ts); a modal puts the ground behind it
 * `inert` by its own tag, which is sent alone too. The wrappers are `display: contents`, and the
 * bento's frame: `src/bento.css` draws the elements in them, and no others.
 */
export function layers(page: string, drawer: string, modal: string): string {
  const ground = `<div class="ground"${modal ? " inert" : ""}>${page}${part("drawers", `<div class="layer">${drawer}</div>`)}</div>`;
  return part("ground", ground) + part("modals", `<div class="layer">${modal}</div>`);
}

/** The surfaces, bound to an example's icons and its session document. */
export function bento<I extends string>({ icon, session: trayDoc, leave }: BentoOptions<I>) {
  // ───────────────────────────── where am I ─────────────────────────────

  /** The trail from the root to the ground you stand on. The last is where you are; each earlier crumb with a `back` is a way back. */
  function crumbs(items: Crumb[]): string {
    return `<nav class="crumbs cap" aria-label="Where you are">${items
      .map((it, i) => {
        const last = i === items.length - 1;
        const sep = i ? `<span class="sep">${icon("chevron-right", 14)}<span class="sr-only">›</span></span>` : "";
        const label = last ? `<b aria-current="page">${esc(it.label)}</b>` : it.back !== undefined ? `<a href="#"${it.back}>${esc(it.label)}</a>` : `<span class="root">${esc(it.label)}</span>`;
        return `<span class="crumb">${sep}${label}</span>`;
      })
      .join("")}</nav>`;
  }

  // ───────────────────────────── the tools ─────────────────────────────

  /** A verb: a button with a word, or in a stack, a square button with an icon. */
  function tool(text: string, o: ToolOptions<I>): string {
    const word = o.iconOnly ? `<span class="sr-only">${esc(text)}</span>` : esc(text);
    const label = o.label ?? (o.iconOnly ? text : undefined); // a square button says its word to a screen reader
    const pressed = o.pressed === undefined ? "" : ` aria-pressed="${o.pressed}"`;
    const expanded = o.expanded === undefined ? "" : ` aria-expanded="${o.expanded}"`;
    return `<button type="${o.submit ? "submit" : "button"}" class="tool${o.kind ? ` ${o.kind}` : ""}${o.className ? ` ${o.className}` : ""}"${label ? ` aria-label="${esc(label)}"` : ""}${pressed}${expanded}${o.disabled ? " disabled" : ""}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
  }

  /** The page's own tools -- undo and redo, writes to the ledger, the kernel's own document, and leaving -- one stack, at the bottom right of the window, or across beside the trail on the box. */
  function pageTools(lay: "down" | "across" = "down"): string {
    return join(
      `<div class="stack page-tools${lay === "across" ? " across" : ""}" aria-label="Tools">`,
      tool("Undo", { icon: "undo", write: write("ledger", "remove", "/latest"), iconOnly: true }),
      tool("Redo", { icon: "redo", write: write("ledger", "add", "/latest"), iconOnly: true }),
      leave && tool(leave.text, { icon: leave.icon, kind: "quiet", write: write(trayDoc, "remove", leave.path), iconOnly: true }),
      "</div>",
    );
  }

  /**
   * The reading switch: the same figures drawn another way, each with its mark and the
   * write that reads them so -- a collection's reading kept in the session (`readAs`), or a page
   * of its own -- the one on checked (a radio: `aria-checked`, never `aria-pressed`). A stack of its own.
   */
  function readingSwitch(options: [text: string, mark: I | BentoIcon, on: boolean, write: string][]): string {
    return `<div class="stack" role="radiogroup" aria-label="Read as">${options
      .map(([text, mark, on, w]) => `<button type="button" class="tool" role="radio" aria-checked="${on}" aria-label="${esc(text)}"${w}>${icon(mark)}<span class="sr-only">${esc(text)}</span></button>`)
      .join("")}</div>`;
  }

  /** The write that reads a collection another way, kept in the session as `/reading/<key>` (`patchCollections`). */
  const readAs = (key: string, value: string): string => write(trayDoc, "replace", `/reading/${key}`, value);

  /** The plus on a collection's rail: `open` is the write that opens the modal that adds to it. */
  const addTool = (open: string, label: string): string => tool(label, { icon: "plus", write: open, iconOnly: true, label });

  /**
   * Find: on the rail, a tool pressed while it is open; open, a field beside that tool,
   * wherever it stands in the rail (`.find`, the field's anchor), writing the word as it is typed
   * (K3), the eye that hides what misses instead of fading it, and the tally of how many of all the
   * word hits. Closing forgets the word and the eye.
   */
  function findControl(key: string, f: FindState): { tool: string; filter?: string } {
    const open = f.word !== undefined;
    const button = tool("Find", { icon: "search", className: "find", iconOnly: true, pressed: open, write: open ? write(trayDoc, "remove", `/filter/${key}`) : write(trayDoc, "replace", `/filter/${key}`, "") });
    if (!open) return { tool: button };
    const eye = tool(f.hide ? "Show what misses" : "Hide what misses", {
      icon: f.hide ? "eye-off" : "eye",
      iconOnly: true,
      pressed: !!f.hide,
      write: f.hide ? write(trayDoc, "remove", `/hide/${key}`) : write(trayDoc, "replace", `/hide/${key}`, true),
    });
    const filter = join(
      `<div class="filter">`,
      `<form data-write-on="input"><input name="q" type="search" value="${esc(f.word)}" placeholder="Find" aria-label="Find" autocomplete="off" autofocus${write(trayDoc, "replace", `/filter/${key}`)}></form>`,
      `<span class="tally">${f.shown} of ${f.total}</span>`,
      eye,
      "</div>",
    );
    return { tool: button, filter };
  }

  // ───────────────────────────── the tray ─────────────────────────────

  /**
   * A cell, closed: its mark and name, a › because it opens (✎ when it is a thing), a summary, a
   * small reading. One that opens is tapped anywhere (its write is the cell's), and its name is a
   * button, so Tab stops there and Enter or Space opens it: expanded while a thing's drawer is open,
   * and never while it opens a window, since the window is what it grows into.
   */
  function cell(o: CellOptions<I>): Placeable {
    const key = o.key ?? slug(o.name);
    const tap = o.opens ?? o.thing?.open;
    const said = `${esc(o.name)}${o.count != null ? ` · ${o.count}` : ""}`;
    const expanded = ` aria-expanded="${!!o.thing?.chosen}"`;
    const name = tap ? `<button type="button" class="cell-name"${expanded}>${said}</button>` : `<span class="cell-name">${said}</span>`;
    const mark = o.mark ? `<span class="cell-icon">${icon(o.mark, 18)}</span>` : "";
    const chev = o.opens ? `<span class="chev">${icon("chevron-right", 18)}</span>` : o.thing ? `<span class="chev pencil">${icon("pencil", 16)}</span>` : "";
    // opening goes nowhere (K1): a cell that opens names itself for the view transition, in the box's
    // render and the open render alike -- one attribute, one element
    const moving = o.opens ? ` data-moving="${esc(key)}"` : "";
    const html = join(
      `<div class="cell${o.big ? " big" : ""}${o.thing ? " thing" : ""}" data-key="${key}"${moving}${tap ?? ""}>`,
      `<div class="cell-head cap">${mark}${name}${chev}</div>`,
      o.summary && `<p class="cell-summary">${esc(o.summary)}</p>`,
      o.body && `<div class="cell-body">${o.body}</div>`,
      "</div>",
    );
    return { key, span: o.big ? COLUMNS : (o.span ?? 1), rows: 1, html, name: o.name };
  }

  /**
   * The window: the cell open. Its head is the whole trail, as the page's own is, so the
   * way to the root is never lost by opening something: every earlier crumb with a `back` is a way
   * back, one without is only named, and the last is the cell's name. It is a region by that name,
   * so what a screen reader says as the keyboard goes in is what opened.
   */
  function windowOf(trail: Crumb[], open: OpenOptions): string {
    const chev = `<span class="chev">${icon("chevron-right", 14)}</span>`;
    const ways = trail.slice(0, -1).map((c) => (c.back !== undefined ? `<a class="cell-back" href="#"${c.back}><span>${esc(c.label)}</span></a>` : `<span class="cell-root">${esc(c.label)}</span>`) + chev);
    const name = esc(trail[trail.length - 1]!.label);
    return part(open.key, join(
      `<div class="cell open" data-key="${open.key}" data-moving="${esc(open.key)}" role="region" aria-label="${name}">`,
      `<div class="cell-head cap">${ways.join("")}<span class="cell-name">${name}</span></div>`,
      `<div class="rail work">`,
      open.reading,
      open.tools && open.tools.length > 0 && `<div class="stack">${open.tools.join("")}</div>`,
      "</div>",
      `<div class="full">${open.body}${open.note ? `<p class="note">${esc(open.note)}</p>` : ""}</div>`,
      pageTools(),
      // last, though it floats beside find's tool: find opening and closing adds and takes away the
      // window's last child, so the morph (matching by position) meets the reading where it was
      open.filter,
      "</div>",
    ));
  }

  /**
   * A page that is a box: the trail and the page's tools above, the ground's own in place, the
   * cells in the tray -- or, when `open` names one, that cell grown into the window
   * (opening goes nowhere: the same element, `data-moving`, bigger), with its trail floating top-left, its rail
   * at the right and the page's tools at the bottom right. The tray is computed
   * (src/grid.ts): each cell lands in its area, first-fit in the box's own order, and learns
   * which of the tray's corners it sits in, for three columns and for one. While a window is open,
   * what is behind it -- the trail, the other cells, what is in place -- is `inert`: not to be
   * reached or heard until it closes.
   */
  /**
   * A window always has a way back to its box. A trail with no crumb going back (the box's own,
   * however the caller grew it or not) gains one: the box's last crumb goes back to the tray, and
   * the cell is named after it.
   */
  function wayBack(trail: Crumb[], opened: Placeable): Crumb[] {
    if (trail.slice(0, -1).some((c) => c.back !== undefined)) return trail;
    const name = opened.name ?? opened.key;
    const box = trail.length > 1 && trail[trail.length - 1]!.label === name ? trail.slice(0, -1) : trail;
    return [...box.slice(0, -1), { ...box[box.length - 1]!, back: box[box.length - 1]!.back ?? go("") }, { label: name }];
  }

  function boxPage(trail: Crumb[], inPlace: string[], cells: Placeable[], open?: OpenOptions): string {
    const wide = grid(cells, COLUMNS);
    const narrow = grid(cells, 1);
    const cornersOf = (t: Grid, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
    const behind = open ? " inert" : "";
    const placed = cells.map((c) => {
      if (open && c.key === open.key) return windowOf(wayBack(trail, c), open);
      return part(c.key, c.html.replace(`data-key="${c.key}"`, `data-key="${c.key}" data-corners="${cornersOf(wide, c.key)}" data-corners-phone="${cornersOf(narrow, c.key)}" style="grid-area: ${c.key}"${behind}`));
    });
    const areas = (t: Grid): string => t.areas.replace(/\n/g, " ");
    return join(
      `<header class="page-head"${behind}>${crumbs(trail)}${open ? "" : pageTools("across")}</header>`,
      `<section class="page box${open ? " windowed" : ""}">`,
      // always wrapped, so a window opening changes the wrapper's tag and nothing the morph matches by position
      `<div class="in-place"${behind}>`,
      ...inPlace,
      "</div>",
      `<div class="cells" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}</div>`,
      "</section>",
    );
  }

  /**
   * A page that is a collection, not a box: there is nothing to open, so the page is the
   * window itself (a window, whatever it holds) -- the whole trail in its head, its tools on
   * the rail, the reading, the page's tools at the bottom right.
   */
  const collectionPage = (trail: Crumb[], open: OpenOptions): string => `<section class="page windowed">${windowOf(trail, open)}</section>`;

  // ───────────────────────────── the rows ─────────────────────────────

  /** A row of a list: one line per thing, the same columns on every list -- a lead, the words, the state, the mark. One that taps is a button, the whole line. */
  function row(o: RowOptions): string {
    const classes = ["row", o.tap && "tap", o.hushed && "hushed"].filter(Boolean).join(" ");
    const attrs = join(o.id && ` id="${esc(o.id)}"`, o.tap, o.chosen !== undefined && ` aria-expanded="${o.chosen}"`, o.chosen && " data-reveal", o.hidden && " hidden");
    const mark = o.mark === "pencil" ? `<span class="mark">${icon("pencil", 16)}</span>` : o.mark === "chevron" ? `<span class="mark">${icon("chevron-right", 18)}</span>` : "";
    const tag = o.tap ? "button" : "div";
    const html = join(
      `<${tag}${o.tap ? ' type="button"' : ""} class="${classes}"${attrs}>`,
      o.lead && `<span class="lead">${o.lead}</span>`,
      `<span class="words"><span class="what">${esc(o.what)}</span>${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}</span>`,
      o.state && `<span class="state">${o.state}</span>`,
      mark,
      `</${tag}>`,
    );
    return o.id ? part(o.id, html) : html; // a row with an id is sent alone when it alone changed
  }

  // ───────────────────────────── the drawer ─────────────────────────────

  /**
   * A drawer: a panel docked at the right from 820px, beside a page still in reach; a sheet
   * rising from the foot on a phone, over a scrim that closes it. Rendered whenever the session
   * says it is open; `close` is the write that closes it, and its × is what Escape presses. The
   * body keeps its own scroll across renders because the morph keeps the element.
   */
  function drawer(id: string, title: string, body: string, close: string, className = ""): string {
    return join(
      `<div class="scrim"${close}></div>`,
      part(
        id,
        join(
          `<div id="${esc(id)}" class="drawer${className ? ` ${className}` : ""}" role="dialog" aria-label="${esc(title)}">`,
          `<div class="drawer-head"><h2>${esc(title)}</h2><button type="button" class="tool quiet drawer-close" aria-label="Close" data-escape${close}>${icon("x", 18)}</button></div>`,
          `<div class="drawer-body">${body}</div>`,
          "</div>",
        ),
      ),
    );
  }

  // ───────────────────────────── the modal ─────────────────────────────

  /**
   * A modal: new or delete, one question, nothing else. Not `<dialog>.showModal()` --
   * the kernel's client learns no such call, the shape is HTML -- so it carries its own scrim, the
   * way a sheet does, and the page behind it is put `inert` by `layers`. Escape presses the scrim.
   */
  function modal(title: string, close: string, body: string): string {
    return join(`<div class="scrim modal-scrim" data-escape${close}></div>`, `<dialog open class="modal" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}</dialog>`);
  }

  /** Adding a thing is the plus and a modal asking for it -- its name, or the few fields it needs, typed or chosen. `add` is the form's write, `close` the one that puts the modal away; `said`, why the last try was refused (src/refusal.ts `toldAt`), beneath the fields. */
  function addModal(title: string, fields: Field[], add: string, close: string, verb = "Add", said = ""): string {
    const inputs = fields
      .map((f, i) => {
        const asked = `${f.required === false ? "" : " required"}${i === 0 ? " autofocus" : ""}`;
        const control = f.options
          ? `<select name="${esc(f.name)}"${asked}>${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.text)}</option>`).join("")}</select>`
          : `<input name="${esc(f.name)}" type="${f.type ?? "text"}"${f.type === "number" ? ' min="0" step="any"' : ""} value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder ?? "")}" autocomplete="off"${asked}>`;
        return `<label class="modal-field"><span class="note">${esc(f.label)}</span>${control}</label>`;
      })
      .join("");
    const foot = `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool(verb, { icon: "plus", kind: "add", write: "", submit: true })}</div>`;
    return modal(title, close, `<form${add}>${inputs}${said}${foot}</form>`);
  }

  /** Removing a thing asks in a modal too -- a modal is new or delete and nothing else. */
  function confirmModal(title: string, question: string, destroy: string, close: string, verb = "Remove"): string {
    const foot = `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool(verb, { icon: "trash", kind: "danger", write: destroy })}</div>`;
    return modal(title, close, `<p class="note">${esc(question)}</p>${foot}`);
  }

  // ───────────────────────────── where you are ─────────────────────────────

  /** The write that goes to a page: its address, on the session. */
  const go = (page: string): string => write(trayDoc, "replace", "/page", page);

  /**
   * The whole page, a part (`site`): a drawer or a modal opening changes its tag (the address) and
   * a layer inside it, and nothing else is sent. With an address, it carries it (`data-page`), which
   * the client mirrors into the URL, and the write the browser's back and forward send
   * (`data-page-write`); without one (signed out), there is nothing to follow.
   */
  function site(page: string | undefined, html: string, className = ""): string {
    const follows = page === undefined ? "" : ` data-page="${esc(page)}" data-page-write='${JSON.stringify({ doc: trayDoc, op: "replace", path: "/page" })}'`;
    return part("site", `<div class="site${className ? ` ${className}` : ""}"${follows}>${html}</div>`);
  }

  return { crumbs, tool, pageTools, readingSwitch, addTool, findControl, cell, boxPage, collectionPage, row, drawer, addModal, confirmModal, go, site, readAs };
}

// ───────────────────────────── where you are ─────────────────────────────

/**
 * A page's address: where you are, and the one thing open over it -- a drawer or a modal. One
 * string, `path?what=which` ("guests?guest=2", "gifts?new", "board?confirm=ALPH"), so it is one
 * field on the session, one write to open or close, and it can go in the URL: the back button
 * closes a drawer, and a link opens one.
 */
export type Address = { path: string; what?: string; which?: string };

export function parseAddress(page = ""): Address {
  const [path = "", query] = page.split("?", 2);
  if (!query) return { path };
  const [what, which = ""] = query.split("=", 2);
  return { path, what, which };
}

/** The address of `path`, with `what` (and which one) open over it; with no `what`, the page alone. */
export const address = (path: string, what?: string, which: string | number = ""): string => (what ? `${path}?${what}${which === "" ? "" : `=${which}`}` : path);

// ───────────────────────────── the session's own state ─────────────────────────────

/** What `readingSwitch` and `findControl` write, as the session keeps it, each by the collection's name. */
export type Collections = {
  /** How each collection is being read: "photo", "list", ... */
  reading?: Record<string, string>;
  /** Find's own word -- present (even "") once the tool is open, gone once closed. */
  filter?: Record<string, string>;
  /** The eye on find: hide what the word misses instead of dimming it. */
  hide?: Record<string, true>;
};

/**
 * Applies one op at `/reading/<key>`, `/filter/<key>` or `/hide/<key>` to `ui`, in place. False
 * when the path is not one of those, or a remove finds nothing there. Closing find removes just
 * its own key (everything is lit again, not merely emptied) and forgets the eye with it.
 * A session's shape tries this after its own fields.
 */
export function patchCollections(ui: Collections, op: PatchOp): boolean {
  const [field, key] = splitPath(op.path);
  if ((field !== "reading" && field !== "filter" && field !== "hide") || !key) return false;
  const maps = ui as Record<string, Record<string, string | true> | undefined>;
  if (op.op !== "remove") {
    maps[field] = { ...maps[field], [key]: field === "hide" ? true : String(op.value ?? "") };
    return true;
  }
  if (!maps[field] || !(key in maps[field])) return false;
  for (const f of field === "filter" ? ["filter", "hide"] : [field]) {
    const { [key]: _, ...rest } = maps[f] ?? {};
    if (Object.keys(rest).length) maps[f] = rest;
    else delete maps[f];
  }
  return true;
}

/** The fields of the session `patchCollections` keeps, each replaced whole by `collectionsWrite`. */
const COLLECTIONS = ["reading", "filter", "hide"] as const;

/**
 * A session's `permit` and `shape` for the bento's own writes: a reading switched (`replace
 * /reading/<key>`), find's word and its eye set or put away (`replace` or `remove` at
 * `/filter/<key>`, `/hide/<key>`). Undefined when `op` is not one: refuse it, or it is the
 * session's own. Otherwise it is applied to `ui`, in place, and what comes back is the ops the
 * session keeps it by: each of `reading`, `filter` and `hide` it moved, replaced whole (null once
 * empty), none when it moved nothing. A permit asks `collectionsWrite(op) !== undefined`; a shape
 * hands in the session as it is, and each op after the one before.
 */
export function collectionsWrite(op: PatchOp, ui: Collections = {}): PatchOp[] | undefined {
  const [field, key, more] = splitPath(op.path);
  const verbs = field === "reading" ? ["replace"] : field === "filter" || field === "hide" ? ["replace", "remove"] : [];
  if (!key || more !== undefined || !verbs.includes(op.op)) return undefined;
  const before = COLLECTIONS.map((f) => JSON.stringify(ui[f]));
  patchCollections(ui, op);
  return COLLECTIONS.filter((f, i) => JSON.stringify(ui[f]) !== before[i]).map((f): PatchOp => ({ op: "replace", path: `/${f}`, value: ui[f] ?? null }));
}
