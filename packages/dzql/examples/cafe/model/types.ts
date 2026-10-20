// The model, now: delta's definitions, a row type per table and each document's shape. Written by `dzql model` from the model's page; never edited by hand.
// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).
import { defineDoc, defineSchema } from "@blueshed/delta/json";

// The model's tables: an app that keeps more (who signs in, its sessions) defines them beside these,
// `defineSchema({ ...tables, ... })`, and runs its own migrations after the model's.
export const tables: Parameters<typeof defineSchema>[0] = {
  tables: { columns: { name: "text?", seated: "boolean?" }, temporal: true },
  items: { columns: { name: "text?", price: "real?" }, temporal: true },
  visits: { columns: { table: "text?" }, temporal: true },
  invoices: { columns: { paid: "boolean?" }, temporal: true, parent: "tables" },
  orders: { columns: { dish_id: "integer?", dish_name: "text?", dish_price: "real?", status: "text?", table_id: "integer?" }, temporal: true, parent: "invoices" },
};

export const schema = defineSchema(tables);

export const docs = [
  // for: The manager says what tables there are
  // for: The manager seats a customer at a free table and opens an invoice for it
  // for: The customer pays their invoice, which frees the table
  // every tables: opened as "floor:"
  defineDoc("floor:", { root: "tables", include: [] }),
  // for: The cook says what is on the menu
  // for: A customer cannot change the menu, say what tables there are, seat, open invoices, or say an order is ready or placed
  // for: The manager cannot change the menu: that is the cook's
  // every items: opened as "menu:"
  defineDoc("menu:", { root: "items", include: [] }),
  // for: A customer scans the code on their table
  // each person's own: say whose with `owns` (a path to the person) once people sign in
  defineDoc("visit:", { root: "visits", include: [], implied: true }),
  // for: The manager seats a customer at a free table and opens an invoice for it
  // for: The manager cannot open an invoice on a table that already has an unpaid one
  // for: The customer orders from the menu onto their invoice
  // for: The cook says an order is ready
  // for: The manager takes a ready order to its table and marks it placed
  // for: The customer pays their invoice, which frees the table
  // for: A customer cannot add to a paid invoice
  // for: The manager cannot order, pay or say an order is ready: that is the customer's and the cook's
  // for: The cook cannot say what tables there are, seat, open invoices, order, pay or place an order: that is the manager's and the customer's
  // for: A customer cannot change the menu, say what tables there are, seat, open invoices, or say an order is ready or placed
  defineDoc("table:", { root: "tables", include: ["invoices", "orders"], implied: true }),
  // for: The manager says what tables there are
  // for: A customer scans the code on their table
  // every tables: opened as "door:"
  defineDoc("door:", { root: "tables", include: [], columns: { tables: ["name"] } }),
  // for: The customer orders from the menu onto their invoice
  // for: The cook says an order is ready
  // for: The manager takes a ready order to its table and marks it placed
  // for: The manager cannot order, pay or say an order is ready: that is the customer's and the cook's
  // for: The cook cannot say what tables there are, seat, open invoices, order, pay or place an order: that is the manager's and the customer's
  // every orders: opened as "kitchen:"
  defineDoc("kitchen:", { root: "orders", include: [] }),
];

export type TablesRow = { id: number; name: string | null; seated: boolean | null; };
export type ItemsRow = { id: number; name: string | null; price: number | null; };
export type VisitsRow = { id: number; table: string | null; };
export type InvoicesRow = { id: number; tables_id: number; paid: boolean | null; };
export type OrdersRow = { id: number; invoices_id: number; dish_id: number | null; dish_name: string | null; dish_price: number | null; status: string | null; table_id: number | null; };

export type FloorDoc = { tables: Record<string, TablesRow>; };
export type MenuDoc = { items: Record<string, ItemsRow>; };
export type VisitDoc = { visits: VisitsRow; };
export type TableDoc = { tables: TablesRow; invoices: Record<string, InvoicesRow>; orders: Record<string, OrdersRow>; };
export type DoorDoc = { tables: Record<string, TablesRow>; };
export type KitchenDoc = { orders: Record<string, OrdersRow>; };
