import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { refuse } from "dzql/rendering/refusal";
import { docs, type FloorDoc, type InvoicesRow, type OrdersRow, type TablesRow } from "../../model/types";
import { register } from "../../store";
import { read as menu, type Item } from "../menu/menu-api";

// The floor: every table, its invoices and their orders -- the manager's and the cook's. A list
// (`floor:`, the model's `list`), on the ledger. Who may write it is the model's guards' (../../store.ts);
// what a write becomes is here. Ids are text, as the wire says them.
register(docs.filter((d) => d.prefix === "floor:"));

export type Table = { id: string; name: string; seated: boolean };
export type Invoice = { id: string; table: string; paid: boolean };
/** An order as it is shown: its dish, by the menu while the dish is on it, else by the surrogate the order kept (`dish_name`, `dish_price`). */
export type Order = { id: string; invoice: string; dish: string; item: string; price: number; status: "ordered" | "ready" | "placed" };

const byId = <T extends { id: string }>(a: T, b: T) => Number(a.id) - Number(b.id);
export const tableOf = (t: TablesRow): Table => ({ id: String(t.id), name: t.name ?? "", seated: !!t.seated });
export const invoiceOf = (i: InvoicesRow): Invoice => ({ id: String(i.id), table: String(i.tables_id), paid: !!i.paid });
/**
 * An order names its dish (`dish_id`) and keeps its surrogate beside it, copied as it was ordered.
 * While the dish is on the menu, the order shows the menu's; once it is taken off, its own copy.
 */
export function orderOf(o: OrdersRow, items: Item[]): Order {
  const dish = items.find((i) => i.id === String(o.dish_id));
  return { id: String(o.id), invoice: String(o.invoices_id), dish: String(o.dish_id ?? ""), item: dish?.name ?? o.dish_name ?? "", price: dish?.price ?? o.dish_price ?? 0, status: (o.status ?? "ordered") as Order["status"] };
}

export type Floor = { tables: Table[]; invoices: Invoice[]; orders: Order[] };

/** The floor, as the page reads it. */
export function read(): Floor {
  const doc = readDoc<FloorDoc>("floor:");
  const items = menu(); // what the orders name: the floor holds the menu too
  return {
    tables: Object.values(doc.tables ?? {}).map(tableOf).sort(byId),
    invoices: Object.values(doc.invoices ?? {}).map(invoiceOf).sort(byId),
    orders: Object.values(doc.orders ?? {}).map((o) => orderOf(o, items)).sort(byId),
  };
}

/** A table's unpaid invoice, if it has one. */
export const openInvoice = (invoices: Invoice[], table: string): Invoice | undefined => invoices.find((i) => i.table === table && !i.paid);
/** An invoice's total. */
export const total = (orders: Order[], invoice: string): number => orders.filter((o) => o.invoice === invoice).reduce((sum, o) => sum + o.price, 0);
/** A price, as the menu says it. */
export const money = (n: number): string => `£${n.toFixed(2)}`;

/** May this be sent to the floor? Only what its pages send: who may is the guards'. */
export function may(op: PatchOp): boolean {
  const [coll, id, field] = splitPath(op.path);
  if (op.op === "add") return (coll === "tables" || coll === "invoices") && id === "-" && field === undefined;
  return op.op === "replace" && coll === "orders" && /^\d+$/.test(id ?? "") && field === "status" && (op.value === "ready" || op.value === "placed");
}

/** The floor's writes as it keeps them: a table named, free; an invoice opened, unpaid, which seats its table. */
export function shape(ops: PatchOp[], f: Floor): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [coll] = splitPath(op.path);
    if (coll === "tables") {
      const name = String(op.value ?? "").trim();
      if (!name) throw refuse("A table needs a name.");
      return [{ op: "add", path: "/tables/-", value: { name, seated: false } }];
    }
    if (coll === "invoices") {
      const table = f.tables.find((t) => t.id === String((op.value as { tables_id?: unknown } | null)?.tables_id));
      if (!table) throw refuse("There is no such table.");
      return [
        { op: "add", path: "/invoices/-", value: { tables_id: Number(table.id), paid: false } },
        { op: "replace", path: `/tables/${table.id}/seated`, value: true },
      ];
    }
    return [op];
  });
}
