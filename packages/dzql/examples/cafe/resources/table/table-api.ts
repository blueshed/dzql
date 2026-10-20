import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { refuse } from "dzql/rendering/refusal";
import { docs, type InvoicesRow, type TableDoc } from "../../model/types";
import { register } from "../../store";
import { tableOf, type Table } from "../floor/floor-api";
import { orderOf, type Order } from "../kitchen/kitchen-api";
import { read as menu, type Item } from "../menu/menu-api";

// A table, as the customer at it reads it: the table, its invoices and their orders. One row
// (`table:1`), on the ledger. Which table is the customer's, their visit says (they scanned it); the
// manager opens a table's own document from the floor, to seat it and to place what is ready there.
register(docs.filter((d) => d.prefix === "table:"));

export type Invoice = { id: string; table: string; paid: boolean };
export type TableView = { table: Table; invoices: Invoice[]; orders: Order[] };

export const invoiceOf = (i: InvoicesRow): Invoice => ({ id: String(i.id), table: String(i.tables_id), paid: !!i.paid });

/** A table, its invoices and their orders. */
export function read(id: string): TableView {
  const doc = readDoc<TableDoc>(`table:${id}`);
  const byId = <T extends { id: string }>(a: T, b: T) => Number(a.id) - Number(b.id);
  const items = menu(); // what the orders name: whoever holds the table holds the menu
  return { table: tableOf(doc.tables), invoices: Object.values(doc.invoices ?? {}).map(invoiceOf).sort(byId), orders: Object.values(doc.orders ?? {}).map((o) => orderOf(o, items)).sort(byId) };
}

/** A table's unpaid invoice, if it has one. */
export const openInvoice = (invoices: Invoice[], table: string): Invoice | undefined => invoices.find((i) => i.table === table && !i.paid);
/** An invoice's total. */
export const total = (orders: Order[], invoice: string): number => orders.filter((o) => o.invoice === invoice).reduce((sum, o) => sum + o.price, 0);

/** May this be sent to a table, by the customer at it (ordering, paying) or the manager (seating it, placing an order there)? What their pages send: who may is the guards'. */
export function may(op: PatchOp, role: string | null): boolean {
  const [coll, id, field] = splitPath(op.path);
  if (role === "manager") return op.op === "add" ? coll === "invoices" && id === "-" && field === undefined : op.op === "replace" && coll === "orders" && /^\d+$/.test(id ?? "") && field === "status" && op.value === "placed";
  if (role !== "customer") return false;
  if (op.op === "add") return coll === "orders" && id === "-" && field === undefined;
  return op.op === "replace" && coll === "invoices" && /^\d+$/.test(id ?? "") && field === "paid" && op.value === true;
}

/**
 * A table's writes as it keeps them: an invoice opened, unpaid, which seats it; an order names its
 * dish and its table, and keeps its surrogate, the dish's name and price as the menu has them now;
 * paying frees the table.
 */
export function shape(ops: PatchOp[], t: TableView, items: Item[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [coll] = splitPath(op.path);
    if (coll === "invoices" && op.op === "add") return [{ op: "add", path: "/invoices/-", value: { tables_id: Number(t.table.id), paid: false } }, { op: "replace", path: "/tables/seated", value: true }];
    if (coll === "invoices") return [op, { op: "replace", path: "/tables/seated", value: false }];
    if (op.op === "replace") return [op];
    const said = (op.value ?? {}) as { invoices_id?: unknown; dish_id?: unknown };
    const invoice = t.invoices.find((i) => i.id === String(said.invoices_id));
    if (!invoice) throw refuse("That is not an invoice at this table.");
    const item = items.find((i) => i.id === String(said.dish_id));
    if (!item) throw refuse("That is not on the menu.");
    return [{ op: "add", path: "/orders/-", value: { invoices_id: Number(invoice.id), table_id: Number(t.table.id), dish_id: Number(item.id), dish_name: item.name, dish_price: item.price, status: "ordered" } }];
  });
}
