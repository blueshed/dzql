import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { docs, type KitchenDoc, type OrdersRow } from "../../model/types";
import { register } from "../../store";
import { read as menu, type Item } from "../menu/menu-api";

// The kitchen: the orders still to cook or to take -- the cook's and the manager's. A list of the
// model's `kitchen` scoped by its status: `kitchen:placed` is every order whose status is not
// placed, so it holds only what is open, never every order the cafe has taken. An order placed at
// its table (through the table's own document, ../table/) leaves it, and every page that read it
// is told; one paid for before it comes stays until it is placed. On the ledger. Who may write it
// is the model's guards' (../../store.ts); what a write becomes is here.
register(docs.filter((d) => d.prefix === "kitchen:").map((d) => ({ ...d, scope: { status: "!=:id" } })));

/** The kitchen's one document: what is not yet placed. */
export const KITCHEN = "placed";

/** An order as it is shown: its dish, by the menu while the dish is on it, else by the surrogate the order kept (`dish_name`, `dish_price`), and the table it goes to. */
export type Order = { id: string; invoice: string; table: string; dish: string; item: string; price: number; status: "ordered" | "ready" | "placed" };

/**
 * An order names its dish (`dish_id`) and keeps its surrogate beside it, copied as it was ordered.
 * While the dish is on the menu, the order shows the menu's; once it is taken off, its own copy.
 */
export function orderOf(o: OrdersRow, items: Item[]): Order {
  const dish = items.find((i) => i.id === String(o.dish_id));
  return { id: String(o.id), invoice: String(o.invoices_id), table: String(o.table_id ?? ""), dish: String(o.dish_id ?? ""), item: dish?.name ?? o.dish_name ?? "", price: dish?.price ?? o.dish_price ?? 0, status: (o.status ?? "ordered") as Order["status"] };
}

/** The kitchen, as the page reads it: each order still to cook or to take. */
export function read(): Order[] {
  const items = menu(); // what the orders name: the kitchen holds the menu too
  return Object.values(readDoc<KitchenDoc>(`kitchen:${KITCHEN}`).orders ?? {}).map((o) => orderOf(o, items)).sort((a, b) => Number(a.id) - Number(b.id));
}

/** May this be sent to the kitchen? Only what its page sends, an order said ready: who may is the guards'. */
export function may(op: PatchOp): boolean {
  const [coll, id, field] = splitPath(op.path);
  return op.op === "replace" && coll === "orders" && /^\d+$/.test(id ?? "") && field === "status" && op.value === "ready";
}
