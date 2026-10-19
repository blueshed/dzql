/**
 * Bento — the page's surfaces, drawn by railroad: the trail and the heading, the box and its cells,
 * rows, runs and pins, the drawer, the modal, fields and tools. The same HTML and classes as dzql's
 * bento.ts (`dzql/rendering/bento`, the page the server draws), so this page is drawn by the same
 * stylesheet (`dzql/rendering/bento-plain.css`, in styles.css), and moving a page to the server is
 * turning each handler here into a write there. tests/bento.test.ts holds the two to the same HTML.
 *
 * What differs is only what a browser-drawn page does itself: a gesture is a handler (`Act`), not a
 * `data-write`; where you are is the URL, `#/<path>?<what>=<which>` (`here`, `go`), so Back closes a
 * drawer and a link opens one; Escape presses the last `[data-escape]`, as the server's client does.
 *
 * import { bento, go, here } from "../bento";
 * const { boxPage, cell, row, rows, drawer, tool } = bento();
 * cell({ name: "Your order", opens: go("order"), summary: () => `${n.get()} lines` })
 *
 * A value a page shows may be a signal or a function (`Live`), and stays live where it is drawn.
 * What a page is made of is drawn again only when you go elsewhere (`paged`); what is open over it,
 * the drawer and the modal, when you open or close it (`layers`); a list as it grows (`rowsOf`).
 */
import { computed, effect, list, navigate, signal, Signal, untrack, when, type ReadonlySignal } from "@blueshed/railroad";
import { createElement as lucide, ChevronRight, Eye, EyeOff, Pencil, Plus, Redo2, Search, Trash2, Undo2, X } from "lucide";
import { address, parseAddress, type Address } from "dzql/rendering/bento";
import { grid, slug, type Grid } from "dzql/rendering/grid";

/** A lucide icon, as `lucide` exports one. */
export type Mark = Parameters<typeof lucide>[0];
/** A gesture: what a press does. */
export type Act = () => void;
/** A value drawn live: as it is, or a signal, or a function read where it is drawn. */
export type Live<T> = T | ReadonlySignal<T> | (() => T);

const read = <T,>(v: Live<T>): T => (v instanceof Signal ? (v as ReadonlySignal<T>).get() : typeof v === "function" ? (v as () => T)() : (v as T));
/** A live boolean as an aria attribute's word: "true" or "false", never absent. */
const said = (v: Live<boolean>) => () => String(!!read(v));
/** A boolean attribute: there ("") or not. */
const flag = (v: Live<boolean | undefined> | undefined) => (v === undefined ? undefined : () => (read(v) ? "" : false));
const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

/** A mark at a size, as the server draws one: `icon icon-<name>`, hidden from a screen reader. */
export function mark(node: Mark, size = 16, name?: string): SVGElement {
  return lucide(node, { class: name ? `icon icon-${name}` : "icon", width: size, height: size, "aria-hidden": "true" });
}

// ───────────────────────────── where you are ─────────────────────────────

const hashOf = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));
const where = signal<Address>(parseAddress(hashOf()));
addEventListener("hashchange", () => where.set(parseAddress(hashOf())));

/** Where you are: the path, and the one thing open over it (`what`, and `which` one). */
export const here: ReadonlySignal<Address> = where;

/** The gesture that goes there: a step in the history, so Back comes back. */
export const go =
  (path: string, what?: string, which: string | number = ""): Act =>
  () => {
    navigate(`/${address(path, what, which)}`);
    where.set(parseAddress(hashOf()));
  };

// Escape puts away what was opened last: the last `[data-escape]` on the page, pressed
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const away = [...document.querySelectorAll<HTMLElement>("[data-escape]")].at(-1);
  if (!away) return;
  event.preventDefault();
  away.click();
});

const pressing = (act: Act | undefined) => act && ((event: Event) => (event.preventDefault(), act()));

// ───────────────────────────── the options ─────────────────────────────

export interface Crumb {
  label: string;
  /** The gesture that goes back to it; the root without one is named but not a place. */
  back?: Act;
}

export interface ToolOptions {
  icon?: Mark;
  kind?: "add" | "quiet" | "danger";
  on?: Act;
  label?: string;
  iconOnly?: boolean;
  pressed?: Live<boolean>;
  expanded?: Live<boolean>;
  disabled?: Live<boolean>;
  submit?: boolean;
  className?: string;
}

export interface CellOptions {
  name: string;
  count?: Live<number | string | null | undefined>;
  summary?: Live<string | null | undefined>;
  /** Opens it into the window: › into it. */
  opens?: Act;
  key?: string;
  big?: boolean;
  span?: number;
  rows?: number;
  body?: Node;
  mark?: Mark;
  pins?: Node[];
  /** A thing: opens its drawer, lit while it is open. */
  thing?: { open: Act; chosen: Live<boolean> };
}

/** A cell as the tray places it. */
export interface Placed {
  key: string;
  span: number;
  rows: number;
  node: Node;
  name?: string;
}

export interface OpenOptions {
  key: string;
  reading?: Node;
  tools?: Node[];
  filter?: Node;
  body: Node;
  note?: string | null;
}

export interface Heading {
  logo?: Node;
  actions?: Node[];
}

export interface RowOptions {
  id?: string;
  tap?: Act;
  chosen?: Live<boolean>;
  hushed?: Live<boolean>;
  hidden?: Live<boolean>;
  lead?: Node;
  what: Live<string>;
  note?: Live<string | null | undefined>;
  state?: Live<string> | Node;
  mark?: "pencil" | "chevron";
  act?: Node | "";
  total?: boolean;
}

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "email" | "number" | "date" | "url";
  options?: { value: string; text: string }[];
  required?: boolean;
  value?: string;
}

export type FieldKind = "text" | "textarea" | "number" | "date" | "email" | "select" | "checkbox";

export interface FieldOptions {
  /** The document and the path it edits, as the server's field names them: its id and its name. */
  doc: string;
  path: string;
  value: Live<string | number | boolean | null | undefined>;
  label: string;
  kind?: FieldKind;
  options?: { value: string; text: string }[];
  placeholder?: string;
  on?: "blur" | "change" | "input";
  may?: boolean;
  said?: Node;
  inRow?: boolean;
  /** What it does with what was typed or chosen, on its trigger. */
  write: (value: string | number | boolean) => void;
}

export interface FindState {
  word: Signal<string | undefined>;
  hide: Signal<boolean>;
  shown: Live<number>;
  total: Live<number>;
}

// ───────────────────────────── the plain parts ─────────────────────────────

/** A list: its rows, or the note that says there are none. */
export const rows = (items: Node[], empty: string): Node => (items.length ? <div class="rows">{items}</div> : <p class="note">{empty}</p>);

/** A list that changes: a row each, by its key, drawn as it comes and taken out as it goes. */
export function rowsOf<T>(items: ReadonlySignal<T[]>, key: (item: T) => string | number, row: (item: ReadonlySignal<T>) => Node, empty: string): Node {
  return when(
    () => items.get().length > 0,
    () => <div class="rows">{list(items, key, row)}</div>,
    () => <p class="note">{empty}</p>,
  );
}

/** The page, drawn again when you go elsewhere (`here`'s path), and not when something opens over it. */
export function paged(draw: (path: string) => Node): Node {
  const path = computed(() => here.get().path);
  const draws = (el: HTMLElement) =>
    effect(() => {
      const at = path.get(); // tracked: the page is drawn again when you go elsewhere
      el.replaceChildren(untrack(() => draw(at))); // and only then, whatever the drawing reads
    });
  return <div class="paged" ref={draws} />;
}

/** A run: the heading of a group of rows in one list. */
export const run = (name: string): Node => <h3 class="run">{name}</h3>;

/** A property in a drawer: its name, and its value or what sets it. */
export const prop = (name: string, value: Node | string): Node => (
  <div class="prop">
    <span class="prop-name cap">{name}</span>
    <div class="prop-value">{value}</div>
  </div>
);

const CHOSEN = new Set<FieldKind>(["date", "select", "checkbox"]);

/** A field that edits one value in place: written on its trigger, its label tied to it, read where it may not be changed. */
export function field(o: FieldOptions): Node {
  const kind = o.kind ?? "text";
  const id = `field-${o.doc}${o.path}`.replace(/[^\w-]/g, "-");
  if (o.may === false) {
    const shown = () => {
      const v = read(o.value);
      return kind === "select" ? (o.options?.find((c) => c.value === String(v ?? ""))?.text ?? "") : kind === "checkbox" ? (v ? "Yes" : "No") : String(v ?? "");
    };
    return o.inRow ? <span class="field">{shown}</span> : prop(o.label, <>{shown}</>);
  }
  const name = o.path.slice(o.path.lastIndexOf("/") + 1);
  const on = o.on ?? (CHOSEN.has(kind) ? "change" : "blur");
  const describedBy = o.said === undefined ? undefined : `${id}-said`;
  let el!: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  // what the page shows follows the document, but never over what is being typed
  const drawn = (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    el = node;
    effect(() => {
      const v = read(o.value);
      if (document.activeElement === node) return;
      if (node instanceof HTMLInputElement && node.type === "checkbox") node.checked = !!v;
      else node.value = String(v ?? "");
    });
  };
  const value = () => (el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : kind === "number" ? Number(el.value) : el.value);
  const control =
    kind === "textarea" ? (
      <textarea class="field" id={id} name={name} aria-describedby={describedBy} placeholder={o.placeholder} rows="3" ref={drawn} />
    ) : kind === "select" ? (
      <select class="field" id={id} name={name} aria-describedby={describedBy} ref={drawn}>
        {(o.options ?? []).map((c) => (
          <option value={c.value} selected={c.value === String(read(o.value) ?? "")}>{c.text}</option>
        ))}
      </select>
    ) : kind === "checkbox" ? (
      <input id={id} name={name} aria-describedby={describedBy} type="checkbox" ref={drawn} />
    ) : (
      <input class="field" id={id} name={name} aria-describedby={describedBy} type={kind} step={kind === "number" ? "any" : undefined} placeholder={o.placeholder} autocomplete="off" ref={drawn} />
    );
  const status = o.said === undefined ? null : <div class="field-said" id={`${id}-said`}>{o.said}</div>;
  const label = <label class={o.inRow ? "sr-only" : "prop-name cap"} for={id}>{o.label}</label>;
  const handler = (event: Event) => (event.preventDefault(), o.write(value()));
  const events = on === "input" ? { oninput: handler } : on === "change" ? { onchange: handler } : { onfocusout: handler };
  return o.inRow ? (
    <form class="in-row" data-write-on={on} onsubmit={handler} {...events}>{label}{control}{status}</form>
  ) : (
    <form class="prop" data-write-on={on} onsubmit={handler} {...events}>
      {label}
      <div class="prop-value">{control}{status}</div>
    </form>
  );
}

/** One choice among a few: every option shown, the current one filled. */
export function choice(label: string, options: { text: string; on: Live<boolean>; act: Act; kind?: "yes" | "no" }[], locked = false): Node {
  return (
    <div class="pick" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" class={cls("tool", o.kind)} role="radio" aria-checked={said(o.on)} disabled={locked || undefined} onclick={o.act}>{o.text}</button>
      ))}
    </div>
  );
}

/** What opens over the page: drawn from where you are, again as that changes, or given as it is. */
export type Over = Node | null | ((at: Address) => Node | null);

/**
 * A page with what may open over it: the ground (the page, and the drawer's layer over it) and the
 * modal's layer, behind which the ground is inert. Each layer is drawn from where you are, again
 * when you open or close something, so the page behind is never drawn again: closing changes nothing.
 */
export function layers(page: Node, drawer: Over, modal: Over): Node {
  const asking = signal(false);
  const layer = (over: Over, said?: Signal<boolean>) => (
    <div
      class="layer"
      ref={(el: HTMLElement) =>
        effect(() => {
          const at = here.get();
          const drawn = untrack(() => (typeof over === "function" ? over(at) : over));
          el.replaceChildren(...(drawn ? [drawn] : []));
          said?.set(!!drawn);
        })
      }
    />
  );
  return (
    <>
      <div class="ground" inert={() => (asking.get() ? "" : false)}>
        {page}
        {layer(drawer)}
      </div>
      {layer(modal, asking)}
    </>
  );
}

// ───────────────────────────── the surfaces ─────────────────────────────

/** The surfaces: `undo` and `redo` (each, when given) are the page's tools, `leave` the last of them. */
export function bento(o: { undo?: Act; redo?: Act; leave?: { text: string; icon: Mark; on: Act } } = {}) {
  /** The trail from the root to where you are; each earlier crumb with a way back is one. */
  function crumbs(items: Crumb[]): Node {
    return (
      <nav class="crumbs cap" aria-label="Where you are">
        {items.map((it, i) => (
          <span class="crumb">
            {i ? <span class="sep">{mark(ChevronRight, 14, "chevron-right")}<span class="sr-only">›</span></span> : null}
            {i === items.length - 1 ? <b aria-current="page">{it.label}</b> : it.back ? <a href="#" onclick={pressing(it.back)}>{it.label}</a> : <span class="root">{it.label}</span>}
          </span>
        ))}
      </nav>
    );
  }

  /** A verb: a button with a word, or in a stack, a square one that says its word to a screen reader. */
  function tool(text: string, t: ToolOptions = {}): Node {
    const label = t.label ?? (t.iconOnly ? text : undefined);
    return (
      <button
        type={t.submit ? "submit" : "button"}
        class={cls("tool", t.kind, t.className)}
        aria-label={label}
        aria-pressed={t.pressed === undefined ? undefined : said(t.pressed)}
        aria-expanded={t.expanded === undefined ? undefined : said(t.expanded)}
        disabled={t.disabled === undefined ? undefined : () => !!read(t.disabled!)}
        onclick={t.on}
      >
        {t.icon ? mark(t.icon) : null}
        {t.iconOnly ? <span class="sr-only">{text}</span> : text}
      </button>
    );
  }

  /** The page's tools: undo, redo and leaving, those given, one stack. */
  function pageTools(lay: "down" | "across" = "down"): Node | null {
    if (!o.undo && !o.redo && !o.leave) return null;
    return (
      <div class={cls("stack page-tools", lay === "across" && "across")} aria-label="Tools">
        {o.undo ? tool("Undo", { icon: Undo2, on: o.undo, iconOnly: true }) : null}
        {o.redo ? tool("Redo", { icon: Redo2, on: o.redo, iconOnly: true }) : null}
        {o.leave ? tool(o.leave.text, { icon: o.leave.icon, kind: "quiet", on: o.leave.on, iconOnly: true }) : null}
      </div>
    );
  }

  /** The reading switch: the same figures read another way, the one on checked. */
  function readingSwitch(options: [text: string, mark: Mark, on: Live<boolean>, act: Act][]): Node {
    return (
      <div class="stack" role="radiogroup" aria-label="Read as">
        {options.map(([text, m, on, act]) => (
          <button type="button" class="tool" role="radio" aria-checked={said(on)} aria-label={text} onclick={act}>
            {mark(m)}
            <span class="sr-only">{text}</span>
          </button>
        ))}
      </div>
    );
  }

  /** The plus on a collection's rail: it opens the modal that adds to it. */
  const addTool = (open: Act, label: string): Node => tool(label, { icon: Plus, on: open, iconOnly: true, label });

  /** Find: a tool, pressed while open; open, its field, the tally, and the eye that hides what misses. */
  function findControl(f: FindState): { tool: Node; filter: Node } {
    const open = () => f.word.get() !== undefined;
    const button = tool("Find", { icon: Search, className: "find", iconOnly: true, pressed: open, on: () => (open() ? (f.word.set(undefined), f.hide.set(false)) : f.word.set("")) });
    const eye = (hide: boolean) => tool(hide ? "Show what misses" : "Hide what misses", { icon: hide ? EyeOff : Eye, iconOnly: true, pressed: hide, on: () => f.hide.set(!hide) });
    const filter = when(open, () => (
      <div class="filter">
        <form data-write-on="input" onsubmit={(e: Event) => e.preventDefault()}>
          <input name="q" type="search" value={f.word.peek() ?? ""} placeholder="Find" aria-label="Find" autocomplete="off" autofocus="" oninput={(e: Event) => f.word.set((e.currentTarget as HTMLInputElement).value)} />
        </form>
        <span class="tally">{() => `${read(f.shown)} of ${read(f.total)}`}</span>
        {when(f.hide, () => eye(true), () => eye(false))}
      </div>
    ));
    return { tool: button, filter };
  }

  /** A pin: a small fact of a thing; a button when it opens what it pins. */
  function pin(text: Live<string>, p: { mark?: Mark; on?: Act } = {}): Node {
    return p.on ? (
      <button type="button" class="pin" onclick={p.on}>{p.mark ? mark(p.mark, 12) : null}{text}</button>
    ) : (
      <span class="pin">{p.mark ? mark(p.mark, 12) : null}{text}</span>
    );
  }

  /** A cell, closed: its mark and name, › when it opens (✎ when it is a thing), its pins, a summary, a small reading. */
  function cell(c: CellOptions): Placed {
    const key = c.key ?? slug(c.name);
    const tap = c.opens ?? c.thing?.open;
    const words = () => {
      const n = read(c.count);
      return `${c.name}${n != null ? ` · ${n}` : ""}`;
    };
    const name = tap ? (
      <button type="button" class="cell-name" aria-expanded={c.thing ? said(c.thing.chosen) : "false"}>{words}</button>
    ) : (
      <span class="cell-name">{words}</span>
    );
    const node = (
      <div class={cls("cell", c.big && "big", c.thing && "thing")} data-key={key} data-moving={c.opens ? key : undefined} onclick={tap}>
        <div class="cell-head cap">
          {c.mark ? <span class="cell-icon">{mark(c.mark, 18)}</span> : null}
          {name}
          {c.pins ?? null}
          {c.opens ? <span class="chev">{mark(ChevronRight, 18, "chevron-right")}</span> : c.thing ? <span class="chev pencil">{mark(Pencil, 16, "pencil")}</span> : null}
        </div>
        {c.summary === undefined ? null : when(() => read(c.summary), (s$) => <p class="cell-summary">{s$}</p>)}
        {c.body ? <div class="cell-body">{c.body}</div> : null}
      </div>
    );
    return { key, span: c.big ? COLUMNS : (c.span ?? 1), rows: c.rows ?? 1, node, name: c.name };
  }

  /** The window: the cell open, the whole trail in its head, its rail, its reading, the page's tools, find's field last. */
  function windowOf(trail: Crumb[], open: OpenOptions): Node {
    const chev = () => <span class="chev">{mark(ChevronRight, 14, "chevron-right")}</span>;
    const name = trail[trail.length - 1]!.label;
    return (
      <div class="cell open" data-key={open.key} data-moving={open.key} role="region" aria-label={name}>
        <div class="cell-head cap">
          {trail.slice(0, -1).map((c) => (
            <>
              {c.back ? <a class="cell-back" href="#" onclick={pressing(c.back)}><span>{c.label}</span></a> : <span class="cell-root">{c.label}</span>}
              {chev()}
            </>
          ))}
          <span class="cell-name">{name}</span>
        </div>
        <div class="rail work">
          {open.reading ?? null}
          {open.tools && open.tools.length > 0 ? <div class="stack">{open.tools}</div> : null}
        </div>
        <div class="full">
          {open.body}
          {open.note ? <p class="note">{open.note}</p> : null}
        </div>
        {pageTools()}
        {open.filter ?? null}
      </div>
    );
  }

  /** A window always has a way back to its box. */
  function wayBack(trail: Crumb[], opened: Placed): Crumb[] {
    if (trail.slice(0, -1).some((c) => c.back !== undefined)) return trail;
    const name = opened.name ?? opened.key;
    const box = trail.length > 1 && trail[trail.length - 1]!.label === name ? trail.slice(0, -1) : trail;
    return [...box.slice(0, -1), { ...box[box.length - 1]!, back: box[box.length - 1]!.back ?? go("") }, { label: name }];
  }

  /** A page that is a box: the trail (and the heading) above, what is in place, the cells in the tray, or one grown into the window. */
  function boxPage(trail: Crumb[], inPlace: Node[], cells: Placed[], open?: OpenOptions, heading?: Heading): Node {
    const wide = grid(cells, COLUMNS);
    const narrow = grid(cells, 1);
    const cornersOf = (t: Grid, key: string): string => t.cells.find((c) => c.key === key)!.corners.join(" ");
    const behind = open ? "" : undefined;
    const placed = cells.map((c) => {
      if (open && c.key === open.key) return windowOf(wayBack(trail, c), open);
      const el = c.node as HTMLElement;
      el.setAttribute("data-corners", cornersOf(wide, c.key));
      el.setAttribute("data-corners-phone", cornersOf(narrow, c.key));
      el.style.gridArea = c.key;
      if (open) el.setAttribute("inert", "");
      return el;
    });
    const areas = (t: Grid): string => t.areas.replace(/\n/g, " ");
    const tools = open ? null : pageTools("across");
    return (
      <>
        <header class={cls("page-head", heading && "headed")} inert={behind}>
          {crumbs(trail)}
          {heading ? (
            <div class="heading">
              {heading.logo ?? null}
              <h1>{trail[trail.length - 1]!.label}</h1>
              {heading.actions ?? null}
              {tools}
            </div>
          ) : (
            tools
          )}
        </header>
        <section class={cls("page box", open && "windowed")}>
          <div class="in-place" inert={behind}>{inPlace}</div>
          <div class="cells" style={`--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}`}>{placed}</div>
        </section>
      </>
    );
  }

  /** A page that is a collection: the window alone. */
  const collectionPage = (trail: Crumb[], open: OpenOptions): Node => <section class="page windowed">{windowOf(trail, open)}</section>;

  /** A row of a list: a lead, the words, the state, the mark; one that taps is a button, the whole line, unless it has a deed of its own. */
  function row(r: RowOptions): Node {
    const m = r.mark === "pencil" ? <span class="mark">{mark(Pencil, 16, "pencil")}</span> : r.mark === "chevron" ? <span class="mark">{mark(ChevronRight, 18, "chevron-right")}</span> : null;
    const note = r.note === undefined ? null : when(() => read(r.note), (n$) => <span class="note">{n$}</span>);
    const state = r.state === undefined ? null : <span class="state">{r.state}</span>;
    const reveal = r.chosen === undefined ? undefined : () => (read(r.chosen!) ? "" : false);
    if (r.act !== undefined) {
      const what = r.tap ? (
        <button type="button" class="what" aria-expanded={r.chosen === undefined ? undefined : said(r.chosen)} onclick={r.tap}>{r.what}{m}</button>
      ) : (
        <span class="what">{r.what}{m}</span>
      );
      return (
        <div class={() => cls("row", "acts", read(r.hushed ?? false) && "hushed", r.total && "total")} id={r.id} data-reveal={reveal} hidden={flag(r.hidden)}>
          {r.lead ? <span class="lead">{r.lead}</span> : null}
          <span class="words">{what}{note}</span>
          {state}
          {r.act || null}
        </div>
      );
    }
    const inner = (
      <>
        {r.lead ? <span class="lead">{r.lead}</span> : null}
        <span class="words"><span class="what">{r.what}</span>{note}</span>
        {state}
        {m}
      </>
    );
    const classes = () => cls("row", r.tap && "tap", read(r.hushed ?? false) && "hushed", r.total && "total");
    return r.tap ? (
      <button type="button" class={classes} id={r.id} aria-expanded={r.chosen === undefined ? undefined : said(r.chosen)} data-reveal={reveal} hidden={flag(r.hidden)} onclick={r.tap}>{inner}</button>
    ) : (
      <div class={classes} id={r.id} data-reveal={reveal} hidden={flag(r.hidden)}>{inner}</div>
    );
  }

  /** A drawer: a panel at the right from 820px, a sheet from the foot on a phone; its × is what Escape presses. */
  function drawer(id: string, title: string, body: Node, close: Act, className = ""): Node {
    return (
      <>
        <div class="scrim" onclick={close} />
        <div id={id} class={cls("drawer", className)} role="dialog" aria-label={title}>
          <div class="drawer-head">
            <h2>{title}</h2>
            <button type="button" class="tool quiet drawer-close" aria-label="Close" data-escape="" onclick={close}>{mark(X, 18, "x")}</button>
          </div>
          <div class="drawer-body">{body}</div>
        </div>
      </>
    );
  }

  /** A modal: new or delete, one question, nothing else; Escape presses its scrim. */
  function modal(title: string, close: Act, body: Node): Node {
    return (
      <>
        <div class="scrim modal-scrim" data-escape="" onclick={close} />
        <dialog open="" class="modal" aria-label={title}>
          <h3>{title}</h3>
          {body}
        </dialog>
      </>
    );
  }

  /** Adding a thing: the few fields it needs; `add` is given what was typed, by each field's name. */
  function addModal(title: string, fields: Field[], add: (values: Record<string, string>) => void, close: Act, verb = "Add", told?: Node): Node {
    const submit = (event: Event) => {
      event.preventDefault();
      add(Object.fromEntries([...new FormData(event.currentTarget as HTMLFormElement)].map(([k, v]) => [k, String(v)])));
    };
    return modal(
      title,
      close,
      <form onsubmit={submit}>
        {fields.map((f, i) => (
          <label class="modal-field">
            <span class="note">{f.label}</span>
            {f.options ? (
              <select name={f.name} required={f.required === false ? undefined : ""} autofocus={i === 0 ? "" : undefined}>
                {f.options.map((c) => <option value={c.value} selected={c.value === f.value}>{c.text}</option>)}
              </select>
            ) : (
              <input name={f.name} type={f.type ?? "text"} min={f.type === "number" ? "0" : undefined} step={f.type === "number" ? "any" : undefined} value={f.value ?? ""} placeholder={f.placeholder ?? ""} autocomplete="off" required={f.required === false ? undefined : ""} autofocus={i === 0 ? "" : undefined} />
            )}
          </label>
        ))}
        {told ?? null}
        <div class="modal-foot">
          {tool("Cancel", { kind: "quiet", on: close })}
          {tool(verb, { icon: Plus, kind: "add", submit: true })}
        </div>
      </form>,
    );
  }

  /** Removing a thing asks one question in a modal. */
  function confirmModal(title: string, question: string, destroy: Act, close: Act, verb = "Remove"): Node {
    return modal(
      title,
      close,
      <>
        <p class="note">{question}</p>
        <div class="modal-foot">
          {tool("Cancel", { kind: "quiet", on: close })}
          {tool(verb, { icon: Trash2, kind: "danger", on: destroy })}
        </div>
      </>,
    );
  }

  return { crumbs, tool, pageTools, readingSwitch, addTool, findControl, pin, cell, boxPage, collectionPage, row, drawer, addModal, confirmModal };
}

/** The tray is three across from 820px and one on a phone (bento.css picks); a box computes both. */
const COLUMNS = 3;
