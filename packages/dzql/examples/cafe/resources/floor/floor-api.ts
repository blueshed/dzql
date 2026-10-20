import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { refuse } from "dzql/rendering/refusal";
import { docs, type FloorDoc, type TablesRow } from "../../model/types";
import { register } from "../../store";

// The floor: every table, free or seated -- the manager's. A list (`floor:`, the model's `list`),
// on the ledger. It holds the tables alone, which do not pile up: a table's invoices are its own
// document's (`table:1`, ../table/), and the orders still to cook or take the kitchen's
// (`kitchen:placed`, ../kitchen/). Who may write it is the model's guards' (../../store.ts); what a
// write becomes is here. Ids are text, as the wire says them.
register(docs.filter((d) => d.prefix === "floor:"));

export type Table = { id: string; name: string; seated: boolean };

export const tableOf = (t: TablesRow): Table => ({ id: String(t.id), name: t.name ?? "", seated: !!t.seated });

/** The floor, as the page reads it: every table. */
export function read(): Table[] {
  return Object.values(readDoc<FloorDoc>("floor:").tables ?? {}).map(tableOf).sort((a, b) => Number(a.id) - Number(b.id));
}

/** A price, as the menu says it. */
export const money = (n: number): string => `£${n.toFixed(2)}`;

/** May this be sent to the floor? Only what its page sends, a table added: who may is the guards'. */
export function may(op: PatchOp): boolean {
  const [coll, id, field] = splitPath(op.path);
  return op.op === "add" && coll === "tables" && id === "-" && field === undefined;
}

/** The floor's writes as it keeps them: a table named, free. */
export function shape(ops: PatchOp[]): PatchOp[] {
  return ops.map((op): PatchOp => {
    const name = String(op.value ?? "").trim();
    if (!name) throw refuse("A table needs a name.");
    return { op: "add", path: "/tables/-", value: { name, seated: false } };
  });
}
