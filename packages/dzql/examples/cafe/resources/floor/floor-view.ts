import { address, prop, rows, type OpenOptions, type Placeable } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "../../surfaces";
import { money, openInvoice, total, type Floor, type Invoice, type Order } from "./floor-api";

// The floor's part of the page: the manager's tables (seating one opens its invoice) and what is
// ready to take; the cook's orders. Each row opens its drawer, where its deed is.

const { tool, cell, row, drawer, addModal, addTool, go } = surfaces;

/** A part of a box: its cell, and, while the visitor stands there, what opens. */
export type Part = { cell: Placeable; title: string; open?: OpenOptions; sheet?: string; modal?: string };
/** Where a visitor stands: the cell they opened, what is open over it, and which. */
export type At = { path: string; what?: string; which?: string };

export const WORD: Record<Order["status"], string> = { ordered: "ordered", ready: "ready", placed: "placed" };

/** Where an order is: its table's name. */
const whereIs = (f: Floor, o: Order): string => f.tables.find((t) => t.id === f.invoices.find((i) => i.id === o.invoice)?.table)?.name ?? "";

/** What an invoice holds, a line each, and its total. */
export function lines(orders: Order[], invoice: Invoice, told: (o: Order) => string): string {
  const items = orders.filter((o) => o.invoice === invoice.id).map((o) => `<span>${esc(o.item)} · ${money(o.price)} · ${WORD[o.status]}</span>${told(o)}`).join("");
  return join(prop("Ordered", items || `<span class="note">nothing yet</span>`), prop("Total", `<span>${money(total(orders, invoice.id))}</span>`));
}

/** The manager's tables. */
export function tables(f: Floor, at: At, sessionId: string): Part {
  const seated = f.tables.filter((t) => t.seated).length;
  const part: Part = { title: "the tables", cell: cell({ key: "tables", name: "the tables", mark: "armchair", count: f.tables.length, opens: go("tables"), summary: `${seated} seated, ${f.tables.length - seated} free` }) };
  if (at.path !== "tables") return part;
  const tableRows = f.tables.map((t) => {
    const inv = openInvoice(f.invoices, t.id);
    return row({ id: `t${t.id}`, tap: go(address("tables", "table", t.id)), chosen: at.what === "table" && at.which === t.id, what: t.name, note: inv ? `${money(total(f.orders, inv.id))} so far` : null, state: t.seated ? "seated" : "free", mark: "pencil" });
  });
  part.open = { key: "tables", tools: [addTool(go(address("tables", "new")), "Add a table")], body: rows(tableRows, "No tables yet: the plus adds one.", "table-rows") };
  const t = at.what === "table" ? f.tables.find((x) => x.id === at.which) : undefined;
  if (t) {
    const inv = openInvoice(f.invoices, t.id);
    const last = f.invoices.filter((i) => i.table === t.id).at(-1);
    const body = join(
      `<div class="props">`,
      prop("It is", `<span>${t.seated ? "seated" : "free"}</span>`),
      inv ? lines(f.orders, inv, (o) => toldAt(sessionId, "floor", `/orders/${o.id}/status`)) : last && prop("Last invoice", `<span>${money(total(f.orders, last.id))}, paid</span>`),
      `</div>`,
      toldAt(sessionId, "floor", "/invoices/-"),
      !t.seated && `<div class="drawer-foot">${tool("Seat and open an invoice", { icon: "receipt", kind: "add", write: write("floor", "add", "/invoices/-", { tables_id: Number(t.id) }) })}</div>`,
    );
    part.sheet = drawer("table", t.name, body, go("tables"), "table-drawer");
  }
  if (at.what === "new") part.modal = addModal("Add a table", [{ name: "name", label: "Its name", placeholder: `Table ${f.tables.length + 1}` }], write("floor", "add", "/tables/-"), go("tables"), "Add", toldAt(sessionId, "floor", "/tables/-"));
  return part;
}

/** What the manager has ready to take. */
export function ready(f: Floor, at: At, sessionId: string): Part {
  const waiting = f.orders.filter((o) => o.status === "ready");
  const part: Part = { title: "ready to take", cell: cell({ key: "ready", name: "ready to take", mark: "bell", count: waiting.length || null, opens: go("ready"), summary: waiting.length ? waiting.map((o) => `${o.item} to ${whereIs(f, o)}`).join(", ") : "nothing waiting" }) };
  if (at.path !== "ready") return part;
  part.open = { key: "ready", body: rows(waiting.map((o) => row({ id: `r${o.id}`, tap: go(address("ready", "order", o.id)), chosen: at.what === "order" && at.which === o.id, what: o.item, note: whereIs(f, o), state: "ready", mark: "pencil" })), "Nothing is ready to take.", "ready-rows") };
  const o = at.what === "order" ? waiting.find((x) => x.id === at.which) : undefined;
  if (o) {
    const body = join(
      `<div class="props">${prop("To", `<span>${esc(whereIs(f, o))}</span>`)}${prop("It is", `<span>${WORD[o.status]}</span>`)}</div>`,
      toldAt(sessionId, "floor", `/orders/${o.id}/status`),
      `<div class="drawer-foot">${tool("Placed", { icon: "platter", kind: "add", write: write("floor", "replace", `/orders/${o.id}/status`, "placed") })}</div>`,
    );
    part.sheet = drawer("order", o.item, body, go("ready"), "order-drawer");
  }
  return part;
}

/** The cook's orders: what is still to cook or to take. */
export function orders(f: Floor, at: At, sessionId: string): Part {
  const cooking = f.orders.filter((o) => o.status !== "placed");
  const waiting = cooking.filter((o) => o.status === "ordered").length;
  const part: Part = { title: "the orders", cell: cell({ key: "orders", name: "the orders", mark: "chef-hat", count: cooking.length || null, opens: go("orders"), summary: waiting ? `${waiting} to cook` : "nothing to cook" }) };
  if (at.path !== "orders") return part;
  part.open = { key: "orders", body: rows(cooking.map((o) => row({ id: `o${o.id}`, tap: go(address("orders", "order", o.id)), chosen: at.what === "order" && at.which === o.id, what: o.item, note: whereIs(f, o), state: WORD[o.status], mark: "pencil" })), "No orders to cook.", "order-rows") };
  const o = at.what === "order" ? cooking.find((x) => x.id === at.which) : undefined;
  if (o) {
    const body = join(
      `<div class="props">${prop("For", `<span>${esc(whereIs(f, o))}</span>`)}${prop("It is", `<span>${WORD[o.status]}</span>`)}</div>`,
      toldAt(sessionId, "floor", `/orders/${o.id}/status`),
      o.status === "ordered" && `<div class="drawer-foot">${tool("Ready", { icon: "check", kind: "add", write: write("floor", "replace", `/orders/${o.id}/status`, "ready") })}</div>`,
    );
    part.sheet = drawer("order", o.item, body, go("orders"), "order-drawer");
  }
  return part;
}
