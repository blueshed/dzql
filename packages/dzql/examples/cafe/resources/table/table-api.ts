import { registerDocs } from "@blueshed/delta/sqlite";
import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { refuse } from "dzql/rendering/refusal";
import { docs, type TableDoc } from "../../model/types";
import { db, delta, schema } from "../../store";
import { invoiceOf, orderOf, tableOf, type Invoice, type Order, type Table } from "../floor/floor-api";
import type { Item } from "../menu/menu-api";

// A table, as the customer at it reads it: the table, its invoices and their orders. One row
// (`table:1`), on the ledger. Which table is the customer's, their visit says (they scanned it).
registerDocs(delta.server, db, schema, docs.filter((d) => d.prefix === "table:"), [], { ledger: true });

export type TableView = { table: Table; invoices: Invoice[]; orders: Order[] };

/** A table, its invoices and their orders. */
export function read(id: string): TableView {
  const doc = readDoc<TableDoc>(`table:${id}`);
  const byId = <T extends { id: string }>(a: T, b: T) => Number(a.id) - Number(b.id);
  return { table: tableOf(doc.tables), invoices: Object.values(doc.invoices ?? {}).map(invoiceOf).sort(byId), orders: Object.values(doc.orders ?? {}).map(orderOf).sort(byId) };
}

/** May the customer at a table send this? Ordering, and paying: what their page sends. */
export function may(op: PatchOp): boolean {
  const [coll, id, field] = splitPath(op.path);
  if (op.op === "add") return coll === "orders" && id === "-" && field === undefined;
  return op.op === "replace" && coll === "invoices" && /^\d+$/.test(id ?? "") && field === "paid" && op.value === true;
}

/** A table's writes as it keeps them: an order is the dish as the menu has it now, ordered; paying frees the table. */
export function shape(ops: PatchOp[], t: TableView, items: Item[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [coll] = splitPath(op.path);
    if (coll === "invoices") return [op, { op: "replace", path: "/tables/seated", value: false }];
    const said = (op.value ?? {}) as { invoices_id?: unknown; items_id?: unknown };
    const invoice = t.invoices.find((i) => i.id === String(said.invoices_id));
    if (!invoice) throw refuse("That is not an invoice at this table.");
    const item = items.find((i) => i.id === String(said.items_id));
    if (!item) throw refuse("That is not on the menu.");
    return [{ op: "add", path: "/orders/-", value: { invoices_id: Number(invoice.id), item: item.name, price: item.price, status: "ordered" } }];
  });
}
