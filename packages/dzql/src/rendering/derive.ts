// A page drawn from a document's shape: a collection's rows as a list, a drawer that changes one,
// and the modals that add one and take one off -- the bento's own parts, worked out at render time
// from what delta's schema says of the collection, and the little an app declares beside it.
// Nothing is generated, and nothing is read but the document: the rows are the ones the page read.
// What may be written is the permit's, asked for each control, so it is said once.
//
// The ladder, and where it stops:
// 1. Derived. A field is typed by its column (a number for an integer or a real, else text; json is
//    not drawn) and named by it, unless declared, and drawn by the bento's `field()`. The add modal
//    asks for what cannot be empty. A row is named by its first column.
// 2. A field declared with an applet is drawn as that applet's mount, given `{ doc, path, current }`
//    and naming the one write it sends. Registering another applet under that name
//    (`registerApplet`, last wins) changes the field on every derived page.
// 3. Past that, the app draws the page itself, from the same parts. Nothing in between: no
//    templates by mode, no blocks, no settings.

import type { ColumnDef, ResolvedTable } from "@blueshed/delta/sqlite";
import { address, field, parseAddress, prop, rows, type bento, type Crumb } from "./bento";
import { appletProps, appletWrites, esc, write, type Op } from "./html";
import { part } from "./parts";

/** What a collection says of itself beyond its columns. */
export type Declared = {
  /** One of them, in words: "venue". */
  noun: string;
  /** A field's name in words, and the applet that draws it, where its column's are not enough. */
  fields?: Record<string, { label?: string; applet?: string }>;
};

type Bento = Pick<ReturnType<typeof bento<never>>, "collectionPage" | "row" | "drawer" | "addModal" | "confirmModal" | "tool" | "addTool" | "go">;

export type Derivation = {
  /** The document its writes go to, as the page names it: "board". */
  doc: string;
  /** The collection, as delta's schema resolves it: `schema.tables.venues`. */
  table: ResolvedTable;
  declared: Declared;
  /** Its rows, as the document holds them. */
  rows: Record<string, unknown>[];
  /** Where the person is: the collection's page, and what is open over it (`?row=1`, `?new`, `?confirm=1`). */
  page: string;
  /** The way here; the collection's own crumb is added. */
  trail: Crumb[];
  /** The permit: may this person make this change? */
  may(op: Op, path: string): boolean;
};

/** A column's name in words: `when_at` is "When at". */
const words = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");
const numeric = (c: ColumnDef): boolean => c.type === "integer" || c.type === "real";

/** The collection's page, and the drawer and the modal open over it, for `layers`. */
export function derivedPage(b: Bento, d: Derivation): { page: string; drawer: string; modal: string } {
  const { docKey: key, columns } = d.table;
  const names = Object.keys(columns).filter((c) => columns[c]!.type !== "json");
  const label = (c: string): string => d.declared.fields?.[c]?.label ?? words(c);
  const at = parseAddress(d.page);
  const go = (what?: string, which: unknown = ""): string => b.go(address(at.path, what, String(which)));
  const nameOf = (r: Record<string, unknown>): string => String(r[names[0]!] ?? "");
  const open = d.rows.find((r) => String(r.id) === at.which);
  const noun = d.declared.noun;

  const list = rows(
    d.rows.map((r) => b.row({ id: `${key}-${r.id}`, tap: go("row", r.id), chosen: at.what === "row" && r === open, what: nameOf(r), mark: "pencil" })),
    `No ${key.replaceAll("_", " ")} yet.`,
    `${key}-rows`,
  );
  const adds = d.may("add", `/${key}/-`);
  const page = b.collectionPage([...d.trail, { label: words(key) }], { key, tools: adds ? [b.addTool(go("new"), `New ${noun}`)] : [], body: list });

  /** A field of the open row, as a property: its applet where one is declared and the permit says yes, else the bento's field, typed by its column. */
  const fieldOf = (r: Record<string, unknown>, c: string): string => {
    const path = `/${key}/${r.id}/${c}`;
    const value = r[c] ?? null;
    const applet = d.declared.fields?.[c]?.applet;
    const may = d.may("replace", path);
    if (applet && may) return prop(label(c), `<div data-applet="${esc(applet)}"${appletWrites([d.doc, "replace", path])}${appletProps({ doc: d.doc, path, current: value })}></div>`);
    return field({ doc: d.doc, path, value: value as string | number | null, label: label(c), kind: numeric(columns[c]!) ? "number" : "text", may });
  };
  const removes = (r: Record<string, unknown>): boolean => d.may("remove", `/${key}/${r.id}`);

  let drawer = "";
  if (open && at.what === "row") {
    const body = `<div class="props">${names.map((c) => part(`${key}-${open.id}-${c}`, fieldOf(open, c))).join("")}</div>`;
    const foot = removes(open) ? `<div class="drawer-foot">${b.tool(`Remove this ${noun}`, { icon: "trash", kind: "danger", write: go("confirm", open.id) })}</div>` : "";
    drawer = b.drawer(`${key}-drawer`, nameOf(open), body + foot, go());
  }

  let modal = "";
  if (at.what === "new" && adds) {
    const asked = names.filter((c) => !columns[c]!.nullable && columns[c]!.default === undefined);
    modal = b.addModal(`New ${noun}`, asked.map((c) => ({ name: c, label: label(c), type: numeric(columns[c]!) ? "number" : "text" })), write(d.doc, "add", `/${key}/-`), go());
  } else if (open && at.what === "confirm" && removes(open)) {
    modal = b.confirmModal(nameOf(open), `Take it off the ${key.replaceAll("_", " ")}?`, write(d.doc, "remove", `/${key}/${open.id}`), go("row", open.id));
  }
  return { page, drawer, modal };
}
