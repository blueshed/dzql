import { registerDocs } from "@blueshed/delta/sqlite";
import { splitPath } from "@blueshed/delta/core";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { refuse } from "dzql/rendering/refusal";
import { docs, type ItemsRow, type MenuDoc } from "../../model/types";
import { db, delta, schema } from "../../store";

// The menu: every dish, the same for the cook and every customer. A list (`menu:`), on the ledger.
registerDocs(delta.server, db, schema, docs.filter((d) => d.prefix === "menu:"), [], { ledger: true });

export type Item = { id: string; name: string; price: number };
const itemOf = (i: ItemsRow): Item => ({ id: String(i.id), name: i.name ?? "", price: i.price ?? 0 });

/** What is on the menu. */
export function read(): Item[] {
  return Object.values(readDoc<MenuDoc>("menu:").items ?? {}).map(itemOf).sort((a, b) => Number(a.id) - Number(b.id));
}

/** May this be sent to the menu? A dish put on or taken off: what its page sends. */
export function may(op: PatchOp): boolean {
  const [coll, id, field] = splitPath(op.path);
  if (coll !== "items" || field !== undefined) return false;
  return op.op === "add" ? id === "-" : op.op === "remove" && /^\d+$/.test(id ?? "");
}

/** The menu's writes as it keeps them: a dish named, at a price. */
export function shape(ops: PatchOp[]): PatchOp[] {
  return ops.map((op): PatchOp => {
    if (op.op !== "add") return op;
    const said = (op.value ?? {}) as { name?: unknown; price?: unknown };
    const name = String(said.name ?? "").trim();
    const price = Number(said.price);
    if (!name) throw refuse("A dish needs a name.");
    if (said.price == null || said.price === "" || !Number.isFinite(price) || price < 0) throw refuse("A dish needs a price.");
    return { op: "add", path: "/items/-", value: { name, price } };
  });
}
