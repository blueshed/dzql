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
  const key = slug(o.name);
  const html = join(
    `<div class="cell${o.big ? " big" : ""}${o.page === undefined ? " whole" : ""}" data-key="${key}"${o.page !== undefined ? nav(o.page) : ""}>`,
    head,
    o.tools && `<div class="cell-tools">${o.tools}</div>`,
    o.body && `<div class="cell-body">${o.body}</div>`,
    summary && `<p class="cell-summary">${esc(summary)}</p>`,
    "</div>",
  );
  return { key, span: o.big ? COLUMNS : 1, rows: 1, html };
}

/**
 * A page that is a box: the crumbs, the ground's own in place, the compartments in the tray, the
 * tools at the foot. The tray is computed (src/tray.ts), not drawn: each compartment lands in its
 * area, first-fit in the box's own order, and learns which of the tray's corners it sits in, once
 * for three columns and once for one -- the stylesheet picks by width.
 */
export function boxPage(trail: Crumb[], inPlace: string[], cells: Placeable[], tools: string[] = []): string {
  const wide = tray(cells, COLUMNS);
  const narrow = tray(cells, 1);
  const cornersOf = (t: Tray, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
  const placed = cells.map((c) =>
    c.html.replace(
      `data-key="${c.key}"`,
      `data-key="${c.key}" data-corners="${cornersOf(wide, c.key)}" data-corners-phone="${cornersOf(narrow, c.key)}" style="grid-area: ${c.key}"`,
    ),
  );
  const areas = (t: Tray): string => t.areas.replace(/\n/g, " ");
  return join(
    crumbs(trail),
    `<section class="page box">`,
    ...inPlace,
    `<div class="cells" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}</div>`,
    tools.length > 0 && `<div class="foot-tools">${tools.join("")}</div>`,
    "</section>",
  );
}

export interface CollectionOptions {
  tools?: string[];
  body: string;
  note?: string | null;
  foot?: string[];
}

/** A page that is a collection: the crumbs, its tools (the reading, what adds to it), the reading, a note. */
export function collectionPage(trail: Crumb[], o: CollectionOptions): string {
  return join(
    crumbs(trail),
    `<section class="page collection">`,
    o.tools && o.tools.length > 0 && `<div class="collection-tools">${o.tools.join("")}</div>`,
    o.body,
    o.note && `<p class="note">${esc(o.note)}</p>`,
    o.foot && o.foot.length > 0 && `<div class="foot-tools">${o.foot.join("")}</div>`,
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

export interface ToolOptions {
  icon?: IconName;
  /** `add` is burgundy; `quiet` sits at the right in plain ink (Leave); `danger` is a removal. */
  kind?: "add" | "quiet" | "danger";
  /** The write attributes (see html.ts's write()). */
  write: string;
  label?: string;
}

/** A verb a page or a compartment offers. */
export function tool(text: string, o: ToolOptions): string {
  return `<button type="button" class="tool${o.kind ? ` ${o.kind}` : ""}"${o.label ? ` aria-label="${esc(o.label)}"` : ""}${o.write}>${o.icon ? icon(o.icon) : ""}${esc(text)}</button>`;
}

/** Undo: a write to the ledger, the kernel's own document, the same on every page. */
export function undoTool(): string {
  return tool("Undo", { icon: "undo", kind: "quiet", write: write("ledger", "remove", "/latest") });
}

/** Redo: the undo walked forward again. */
export function redoTool(): string {
  return tool("Redo", { icon: "redo", kind: "quiet", write: write("ledger", "add", "/latest") });
}

/** Leave: quiet at the right of the foot; the session forgets its code. */
export function leaveTool(): string {
  return tool("Leave", { icon: "log-out", kind: "quiet", write: write("session", "remove", "/code") });
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
