import { address, prop, rows, type OpenOptions, type Placeable } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "../../surfaces";
import type { Order } from "../kitchen/kitchen-api";
import { openInvoice, read as tableOf, total, type Invoice } from "../table/table-api";
import { money, type Table } from "./floor-api";

// The floor's part of the page: the manager's tables, each row opening its drawer, which reads the
// table's own document: what it has ordered, and seating it, which opens its invoice.

const { tool, cell, row, drawer, addModal, addTool, go } = surfaces;

/** A part of a box: its cell, and, while the visitor stands there, what opens. */
export type Part = { cell: Placeable; title: string; open?: OpenOptions; sheet?: string; modal?: string };
/** Where a visitor stands: the cell they opened, what is open over it, and which. */
export type At = { path: string; what?: string; which?: string };

export const WORD: Record<Order["status"], string> = { ordered: "ordered", ready: "ready", placed: "placed" };

/** What an invoice holds, a line each, and its total. */
export function lines(orders: Order[], invoice: Invoice, told: (o: Order) => string): string {
  const items = orders.filter((o) => o.invoice === invoice.id).map((o) => `<span>${esc(o.item)} · ${money(o.price)} · ${WORD[o.status]}</span>${told(o)}`).join("");
  return join(prop("Ordered", items || `<span class="note">nothing yet</span>`), prop("Total", `<span>${money(total(orders, invoice.id))}</span>`));
}

/** The manager's tables. */
export function tables(f: Table[], at: At, sessionId: string): Part {
  const seated = f.filter((t) => t.seated).length;
  const part: Part = { title: "the tables", cell: cell({ key: "tables", name: "the tables", mark: "armchair", count: f.length, opens: go("tables"), summary: `${seated} seated, ${f.length - seated} free` }) };
  if (at.path !== "tables") return part;
  const tableRows = f.map((t) => row({ id: `t${t.id}`, tap: go(address("tables", "table", t.id)), chosen: at.what === "table" && at.which === t.id, what: t.name, state: t.seated ? "seated" : "free", mark: "pencil" }));
  part.open = { key: "tables", tools: [addTool(go(address("tables", "new")), "Add a table")], body: rows(tableRows, "No tables yet: the plus adds one.", "table-rows") };
  const t = at.what === "table" ? f.find((x) => x.id === at.which) : undefined;
  if (t) {
    const doc = `table:${t.id}`;
    const v = tableOf(t.id); // the table's own document: its invoices and their orders
    const inv = openInvoice(v.invoices, t.id);
    const last = v.invoices.at(-1);
    const body = join(
      `<div class="props">`,
      prop("It is", `<span>${t.seated ? "seated" : "free"}</span>`),
      inv ? lines(v.orders, inv, (o) => toldAt(sessionId, "kitchen", `/orders/${o.id}/status`)) : last && prop("Last invoice", `<span>${money(total(v.orders, last.id))}, paid</span>`),
      `</div>`,
      toldAt(sessionId, doc, "/invoices/-"),
      !t.seated && `<div class="drawer-foot">${tool("Seat and open an invoice", { icon: "receipt", kind: "add", write: write(doc, "add", "/invoices/-", { paid: false }) })}</div>`,
    );
    part.sheet = drawer("table", t.name, body, go("tables"), "table-drawer");
  }
  if (at.what === "new") part.modal = addModal("Add a table", [{ name: "name", label: "Its name", placeholder: `Table ${f.length + 1}` }], write("floor", "add", "/tables/-"), go("tables"), "Add", toldAt(sessionId, "floor", "/tables/-"));
  return part;
}
