import { address, prop, rows } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "../../surfaces";
import { WORD, type At, type Part } from "../floor/floor-view";
import { read as tableOf } from "../table/table-api";
import type { Order } from "./kitchen-api";

// The kitchen's part of the page: the cook's orders, still to cook or to take, and what the manager
// has ready to take. Each row opens its drawer, where its deed is. Where an order goes is the name
// of the table it names, as the door lists them (`names`).

const { tool, cell, row, drawer, go } = surfaces;

type Names = { id: string; name: string }[];
const whereIs = (names: Names, o: Order): string => names.find((t) => t.id === o.table)?.name ?? "";

/** What the manager has ready to take. Placing one is a write to its table's own document, which its drawer reads. */
export function ready(kitchen: Order[], names: Names, at: At, sessionId: string): Part {
  const waiting = kitchen.filter((o) => o.status === "ready");
  const part: Part = { title: "ready to take", cell: cell({ key: "ready", name: "ready to take", mark: "bell", count: waiting.length || null, opens: go("ready"), summary: waiting.length ? waiting.map((o) => `${o.item} to ${whereIs(names, o)}`).join(", ") : "nothing waiting" }) };
  if (at.path !== "ready") return part;
  part.open = { key: "ready", body: rows(waiting.map((o) => row({ id: `r${o.id}`, tap: go(address("ready", "order", o.id)), chosen: at.what === "order" && at.which === o.id, what: o.item, note: whereIs(names, o), state: "ready", mark: "pencil" })), "Nothing is ready to take.", "ready-rows") };
  const o = at.what === "order" ? waiting.find((x) => x.id === at.which) : undefined;
  if (o) {
    const doc = `table:${o.table}`;
    const to = tableOf(o.table).table; // the table's own document, which placing it writes
    const body = join(
      `<div class="props">${prop("To", `<span>${esc(to.name)}</span>`)}${prop("It is", `<span>${WORD[o.status]}</span>`)}</div>`,
      toldAt(sessionId, doc, `/orders/${o.id}/status`),
      `<div class="drawer-foot">${tool("Placed", { icon: "platter", kind: "add", write: write(doc, "replace", `/orders/${o.id}/status`, "placed") })}</div>`,
    );
    part.sheet = drawer("order", o.item, body, go("ready"), "order-drawer");
  }
  return part;
}

/** The cook's orders: what is still to cook or to take. */
export function orders(kitchen: Order[], names: Names, at: At, sessionId: string): Part {
  const waiting = kitchen.filter((o) => o.status === "ordered").length;
  const part: Part = { title: "the orders", cell: cell({ key: "orders", name: "the orders", mark: "chef-hat", count: kitchen.length || null, opens: go("orders"), summary: waiting ? `${waiting} to cook` : "nothing to cook" }) };
  if (at.path !== "orders") return part;
  part.open = { key: "orders", body: rows(kitchen.map((o) => row({ id: `o${o.id}`, tap: go(address("orders", "order", o.id)), chosen: at.what === "order" && at.which === o.id, what: o.item, note: whereIs(names, o), state: WORD[o.status], mark: "pencil" })), "No orders to cook.", "order-rows") };
  const o = at.what === "order" ? kitchen.find((x) => x.id === at.which) : undefined;
  if (o) {
    const body = join(
      `<div class="props">${prop("For", `<span>${esc(whereIs(names, o))}</span>`)}${prop("It is", `<span>${WORD[o.status]}</span>`)}</div>`,
      toldAt(sessionId, "kitchen", `/orders/${o.id}/status`),
      o.status === "ordered" && `<div class="drawer-foot">${tool("Ready", { icon: "check", kind: "add", write: write("kitchen", "replace", `/orders/${o.id}/status`, "ready") })}</div>`,
    );
    part.sheet = drawer("order", o.item, body, go("orders"), "order-drawer");
  }
  return part;
}
