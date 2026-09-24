// The surfaces a page that is a box is made of, drawn as the bento mock-up draws them
// (examples/bento): the trail (where am I), the tray and its compartments, the window a
// compartment grows into, the stacks of tools that float in it, the rows of a list, the drawer (a
// panel at the right from 820px, a sheet from the foot on a phone) and its properties, the modal.
// `src/bento.css` is their look, in an example's own tokens. No example knowledge here: an example
// binds this once to its own icons and to the document its tray's state is written to
// (`bento({icon, tray})`), and every gesture is then a `data-write` the caller hands in, or one to
// that document at the paths `patchCollections` below applies.

import { esc, join, write } from "./html";
import { part } from "./parts";
import type { PatchOp } from "./json-patch";
import { parsePointer } from "./json-pointer";
import { slug, tray, type Compartment, type Tray } from "./tray";

/** The marks the surfaces draw themselves, by the names an example's icons must know them by. */
export type BentoIcon = "chevron-right" | "pencil" | "x" | "undo" | "redo" | "plus" | "trash" | "search" | "eye" | "eye-off";

export interface BentoOptions<I extends string> {
  /** The example's own icons. A method, so its names may be fewer than `BentoIcon`: an example
   * brings only the marks the surfaces it uses draw (chat: the chevron, undo, redo), and its own
   * render tests are what say so if one is missing. */
  icon(name: I | BentoIcon, size?: number): string;
  /** The docType the tray's state is written to: chat's and the wedding's `session`, the ticker's `desk`. */
  tray: string;
  /** Leaving, the last of the page's tools, set apart by a rule: removes `path` from the tray. Without one (the ticker: nobody signed in) there is only undo and redo. */
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
  /** The write that opens it into the window: › into it. A thing (rule 15) has none and carries ✎ instead. */
  opens?: string;
  /** The tray's own name for it, when it differs from `slug(name)` ("the day" opens under "day"). */
  key?: string;
  /** Spans the tray: the one that matters more (rule 5). */
  big?: boolean;
  /** Columns it spans when it is not big. Default 1. */
  span?: number;
  /** The small reading (rule 4): the family photo, a few lines. */
  body?: string;
  mark?: I | BentoIcon;
  /** A thing: the write that opens its drawer, and whether the drawer is open (lit while it is). */
  thing?: { open: string; chosen: boolean };
}

/** A compartment as the tray places it: its html, and how much of the tray it asked for. */
export interface Placeable extends Compartment {
  html: string;
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

export interface ToolOptions<I extends string> {
  icon?: I | BentoIcon;
  /** `add` is the accent of making; `quiet` is plain ink (Cancel, Leave); `danger` is a removal. */
  kind?: "add" | "quiet" | "danger";
  /** The write attributes (src/html.ts's write()). */
  write: string;
  label?: string;
  /** In a stack (rule 9): a square button, the word for a screen reader only. */
  iconOnly?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  submit?: boolean;
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
  /** Lit across its whole line while its drawer is open (rule 13), and scrolled into the clear (K2). */
  chosen?: boolean;
  /** Find's word missed it (rule 17): dimmed, or with the eye, hidden. */
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
  type?: "text" | "email" | "number";
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

/** One choice among a few: every option shown, the current one filled. `locked` after a deadline. */
export function choice(label: string, options: Option[], locked = false): string {
  return `<div class="pick" role="radiogroup" aria-label="${esc(label)}">${options
    .map((o) => `<button type="button" class="tool${o.kind ? ` ${o.kind}` : ""}" role="radio" aria-checked="${o.on}" aria-pressed="${o.on}"${o.write}${locked ? " disabled" : ""}>${esc(o.text)}</button>`)
    .join("")}</div>`;
}

/** The page behind a modal is `inert` while it asks -- nothing else may be touched (rule 14). */
/**
 * A page with what may open over it: the ground -- the page, and the drawer's layer over it -- and
 * the modal's layer. Each layer is always there, empty when nothing is open, so opening or closing
 * a drawer or a modal sends that layer alone (src/parts.ts); a modal puts the ground behind it
 * `inert` by its own tag, which is sent alone too. The wrappers are `display: contents`.
 */
export function layers(page: string, drawer: string, modal: string): string {
  const ground = `<div class="ground"${modal ? " inert" : ""}>${page}${part("drawers", `<div class="layer">${drawer}</div>`)}</div>`;
  return part("ground", ground) + part("modals", `<div class="layer">${modal}</div>`);
}

/** The surfaces, bound to an example's icons and its tray's document. */
export function bento<I extends string>({ icon, tray: trayDoc, leave }: BentoOptions<I>) {
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
    return `<button type="${o.submit ? "submit" : "button"}" class="tool${o.kind ? ` ${o.kind}` : ""}"${label ? ` aria-label="${esc(label)}"` : ""}${pressed}${o.disabled ? " disabled" : ""}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
  }

  /** The page's own tools -- undo and redo, writes to the ledger, the kernel's own document, and leaving -- one stack, at the bottom right of the window, or across beside the trail on the box (rule 9). */
  function pageTools(lay: "down" | "across" = "down"): string {
    return join(
      `<div class="stack page-tools${lay === "across" ? " across" : ""}" aria-label="Tools">`,
      tool("Undo", { icon: "undo", write: write("ledger", "remove", "/latest"), iconOnly: true }),
      tool("Redo", { icon: "redo", write: write("ledger", "add", "/latest"), iconOnly: true }),
      leave && tool(leave.text, { icon: leave.icon, kind: "quiet", write: write(trayDoc, "remove", leave.path), iconOnly: true }),
      "</div>",
    );
  }

  /** The reading switch (rule 16): the same figures drawn another way, each with its mark, the current one pressed. A stack of its own. */
  function readingSwitch(key: string, current: string, options: [value: string, mark: I | BentoIcon][]): string {
    return `<div class="stack" role="radiogroup" aria-label="Read as">${options
      .map(([value, mark]) => `<button type="button" class="tool" role="radio" aria-checked="${current === value}" aria-pressed="${current === value}" aria-label="${esc(value)}"${write(trayDoc, "replace", `/reading/${key}`, value)}>${icon(mark)}<span class="sr-only">${esc(value)}</span></button>`)
      .join("")}</div>`;
  }

  /** The plus on a collection's rail: `open` is the write that opens the modal that adds to it. */
  const addTool = (open: string, label: string): string => tool(label, { icon: "plus", write: open, iconOnly: true, label });

  /**
   * Find (rule 17): on the rail, a tool pressed while it is open; open, a field beside the rail
   * writing the word as it is typed (K3), the eye that hides what misses instead of dimming it, and
   * the tally of how many of all the word hits. Closing forgets the word and the eye.
   */
  function findControl(key: string, f: FindState): { tool: string; filter?: string } {
    const open = f.word !== undefined;
    const button = tool("Find", { icon: "search", iconOnly: true, pressed: open, write: open ? write(trayDoc, "remove", `/filter/${key}`) : write(trayDoc, "replace", `/filter/${key}`, "") });
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

  /** A compartment, closed: its mark and name, a › because it opens (✎ when it is a thing), a summary, a small reading. */
  function cell(o: CellOptions<I>): Placeable {
    const key = o.key ?? slug(o.name);
    const name = `<span class="cell-name">${esc(o.name)}${o.count != null ? ` · ${o.count}` : ""}</span>`;
    const mark = o.mark ? `<span class="cell-icon">${icon(o.mark, 18)}</span>` : "";
    const chev = o.opens ? `<span class="chev">${icon("chevron-right", 18)}</span>` : o.thing ? `<span class="chev pencil">${icon("pencil", 16)}</span>` : "";
    const tap = o.opens ?? o.thing?.open;
    // rule 7 (K1): a compartment that opens names itself for the view transition, in the box's
    // render and the open render alike -- one attribute, one element
    const moving = o.opens ? ` data-moving="${esc(key)}"` : "";
    const thing = o.thing ? ` aria-pressed="${o.thing.chosen}"` : "";
    const html = join(
      `<div class="cell${o.big ? " big" : ""}${o.thing ? " thing" : ""}" data-key="${key}"${moving}${thing}${tap ? ` role="button" tabindex="0"${tap}` : ""}>`,
      `<div class="cell-head cap">${mark}${name}${chev}</div>`,
      o.summary && `<p class="cell-summary">${esc(o.summary)}</p>`,
      o.body && `<div class="cell-body">${o.body}</div>`,
      "</div>",
    );
    return { key, span: o.big ? COLUMNS : (o.span ?? 1), rows: 1, html };
  }

  /**
   * The window: the compartment open. Its head is the whole trail, as the page's own is, so the
   * way to the root is never lost by opening something: every earlier crumb with a `back` is a way
   * back, one without is only named, and the last is the compartment's name.
   */
  function windowOf(trail: Crumb[], open: OpenOptions): string {
    const chev = `<span class="chev">${icon("chevron-right", 14)}</span>`;
    const ways = trail.slice(0, -1).map((c) => (c.back !== undefined ? `<a class="cell-back" href="#"${c.back}>${esc(c.label)}</a>` : `<span class="cell-root">${esc(c.label)}</span>`) + chev);
    return part(open.key, join(
      `<div class="cell open" data-key="${open.key}" data-moving="${esc(open.key)}">`,
      `<div class="cell-head cap">${ways.join("")}<span class="cell-name">${esc(trail[trail.length - 1]!.label)}</span></div>`,
      `<div class="rail work">`,
      open.reading,
      open.tools && open.tools.length > 0 && `<div class="stack">${open.tools.join("")}</div>`,
      "</div>",
      open.filter,
      `<div class="full">${open.body}${open.note ? `<p class="note">${esc(open.note)}</p>` : ""}</div>`,
      pageTools(),
      "</div>",
    ));
  }

  /**
   * A page that is a box: the trail and the page's tools above, the ground's own in place, the
   * compartments in the tray -- or, when `open` names one, that compartment grown into the window
   * (rule 7: the same element, `data-moving`, bigger), with its trail floating top-left, its rail
   * at the right and the page's tools at the bottom right (rule 9). The tray is computed
   * (src/tray.ts): each compartment lands in its area, first-fit in the box's own order, and learns
   * which of the tray's corners it sits in, for three columns and for one.
   */
  function boxPage(trail: Crumb[], inPlace: string[], cells: Placeable[], open?: OpenOptions): string {
    const wide = tray(cells, COLUMNS);
    const narrow = tray(cells, 1);
    const cornersOf = (t: Tray, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
    const placed = cells.map((c) => {
      if (open && c.key === open.key) return windowOf(trail, open);
      return part(c.key, c.html.replace(`data-key="${c.key}"`, `data-key="${c.key}" data-corners="${cornersOf(wide, c.key)}" data-corners-phone="${cornersOf(narrow, c.key)}" style="grid-area: ${c.key}"`));
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

  /**
   * A page that is a collection, not a box (rule 1): there is nothing to open, so the page is the
   * window itself (rule 8: a window, whatever it holds) -- the whole trail in its head, its tools on
   * the rail, the reading, the page's tools at the bottom right.
   */
  const collectionPage = (trail: Crumb[], open: OpenOptions): string => `<section class="page windowed">${windowOf(trail, open)}</section>`;

  // ───────────────────────────── the rows ─────────────────────────────

  /** A row of a list: one line per thing, the same columns on every list -- a lead, the words, the state, the mark. */
  function row(o: RowOptions): string {
    const classes = ["row", o.tap && "tap", o.hushed && "hushed"].filter(Boolean).join(" ");
    const attrs = join(o.id && ` id="${esc(o.id)}"`, o.tap && ` role="button" tabindex="0"${o.tap}`, o.chosen !== undefined && ` aria-pressed="${o.chosen}"`, o.chosen && " data-reveal", o.hidden && " hidden");
    const mark = o.mark === "pencil" ? `<span class="mark">${icon("pencil", 16)}</span>` : o.mark === "chevron" ? `<span class="mark">${icon("chevron-right", 18)}</span>` : "";
    const html = join(
      `<div class="${classes}"${attrs}>`,
      o.lead && `<span class="lead">${o.lead}</span>`,
      `<span class="words"><span class="what">${esc(o.what)}</span>${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}</span>`,
      o.state && `<span class="state">${o.state}</span>`,
      mark,
      "</div>",
    );
    return o.id ? part(o.id, html) : html; // a row with an id is sent alone when it alone changed
  }

  // ───────────────────────────── the drawer ─────────────────────────────

  /**
   * A sheet: a panel docked at the right from 820px, a drawer rising from the foot on a phone,
   * over a scrim that closes it. Rendered whenever the tray says it is open; `close` is the
   * write that closes it. The body keeps its own scroll across renders because the morph keeps
   * the element.
   */
  function sheet(id: string, title: string, body: string, close: string, className = ""): string {
    return join(
      `<div class="scrim"${close}></div>`,
      part(
        id,
        join(
          `<div id="${esc(id)}" class="sheet${className ? ` ${className}` : ""}" role="dialog" aria-label="${esc(title)}">`,
          `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="tool quiet sheet-close" aria-label="Close"${close}>${icon("x", 18)}</button></div>`,
          `<div class="sheet-body">${body}</div>`,
          "</div>",
        ),
      ),
    );
  }

  // ───────────────────────────── the modal ─────────────────────────────

  /**
   * A modal: new or delete, one question, nothing else (rule 14). Not `<dialog>.showModal()` --
   * the kernel's client learns no such call, the shape is HTML -- so it carries its own scrim, the
   * way a sheet does, and the page behind it is put `inert` by `layers`.
   */
  function modal(title: string, close: string, body: string): string {
    return join(`<div class="scrim modal-scrim"${close}></div>`, `<dialog open class="modal" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}</dialog>`);
  }

  /** Adding a thing is the plus and a modal asking for it -- its name, or the few fields it needs. `add` is the form's write, `close` the one that puts the modal away. */
  function addModal(title: string, fields: Field[], add: string, close: string, verb = "Add"): string {
    const inputs = fields
      .map(
        (f, i) =>
          `<label class="modal-field"><span class="note">${esc(f.label)}</span><input name="${esc(f.name)}" type="${f.type ?? "text"}"${f.type === "number" ? ' min="0"' : ""} value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder ?? "")}" autocomplete="off"${f.required === false ? "" : " required"}${i === 0 ? " autofocus" : ""}></label>`,
      )
      .join("");
    const foot = `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool(verb, { icon: "plus", kind: "add", write: "", submit: true })}</div>`;
    return modal(title, close, `<form${add}>${inputs}${foot}</form>`);
  }

  /** Removing a thing asks in a modal too -- a modal is new or delete and nothing else (rule 14). */
  function confirmModal(title: string, question: string, destroy: string, close: string, verb = "Remove"): string {
    const foot = `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool(verb, { icon: "trash", kind: "danger", write: destroy })}</div>`;
    return modal(title, close, `<p class="note">${esc(question)}</p>${foot}`);
  }

  return { crumbs, tool, pageTools, readingSwitch, addTool, findControl, cell, boxPage, collectionPage, row, sheet, addModal, confirmModal };
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

// ───────────────────────────── the tray's own state ─────────────────────────────

/** What `readingSwitch` and `findControl` write, as the tray's document keeps it, each by the collection's name. */
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
 * its own key (rule 17: everything is lit again, not merely emptied) and forgets the eye with it.
 * A tray document's shape tries this after its own fields.
 */
export function patchCollections(ui: Collections, op: PatchOp): boolean {
  const [field, key] = parsePointer(op.path);
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
