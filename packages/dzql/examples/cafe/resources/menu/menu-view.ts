import { address, prop, rows } from "dzql/rendering/bento";
import { join, write } from "dzql/rendering/html";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "../../surfaces";
import { money } from "../floor/floor-api";
import type { Invoice } from "../table/table-api";
import type { At, Part } from "../floor/floor-view";
import type { Item } from "./menu-api";

// The menu's part of the page: the cook keeps it (a dish put on, one taken off, asked first); a
// customer orders from it onto their open invoice.

const { tool, cell, row, drawer, addModal, confirmModal, addTool, go } = surfaces;

const menuRows = (items: Item[], at: At) =>
  rows(items.map((i) => row({ id: `i${i.id}`, tap: go(address("menu", "item", i.id)), chosen: at.what === "item" && at.which === i.id, what: i.name, state: money(i.price), mark: "pencil" })), "Nothing is on the menu yet.", "menu-rows");

const menuCell = (items: Item[]) => cell({ key: "menu", name: "the menu", mark: "utensils", count: items.length, opens: go("menu"), summary: items.map((i) => i.name).join(", ") || "nothing on it yet" });

/** The cook's menu. */
export function kept(items: Item[], at: At, sessionId: string): Part {
  const part: Part = { title: "the menu", cell: menuCell(items) };
  if (at.path !== "menu") return part;
  part.open = { key: "menu", tools: [addTool(go(address("menu", "new")), "Put a dish on the menu")], body: menuRows(items, at) };
  const item = items.find((x) => x.id === at.which);
  if (item && at.what === "item") {
    const body = join(
      `<div class="props">${prop("Price", `<span>${money(item.price)}</span>`)}</div>`,
      `<div class="drawer-foot">${tool("Take it off the menu", { icon: "trash", kind: "danger", write: go(address("menu", "confirm", item.id)) })}</div>`,
    );
    part.sheet = drawer("item", item.name, body, go("menu"), "item-drawer");
  }
  if (at.what === "new") part.modal = addModal("Put a dish on the menu", [{ name: "name", label: "The dish", placeholder: "Cake" }, { name: "price", label: "Its price", type: "number", placeholder: "4.00" }], write("menu", "add", "/items/-"), go("menu"), "Add", toldAt(sessionId, "menu", "/items/-"));
  if (item && at.what === "confirm") part.modal = confirmModal(`Take ${item.name} off the menu`, "Customers will no longer see it; what was ordered stays on its invoice.", write("menu", "remove", `/items/${item.id}`), go(address("menu", "item", item.id)), "Take it off");
  return part;
}

/** A customer's menu: each dish, ordered onto their open invoice. */
export function ordering(items: Item[], open: Invoice | undefined, at: At, sessionId: string): Part {
  const part: Part = { title: "the menu", cell: menuCell(items) };
  if (at.path !== "menu") return part;
  part.open = { key: "menu", body: menuRows(items, at) };
  const item = at.what === "item" ? items.find((x) => x.id === at.which) : undefined;
  if (item)
    part.sheet = drawer("item", item.name, join(
      `<div class="props">${prop("Price", `<span>${money(item.price)}</span>`)}</div>`,
      toldAt(sessionId, "table", "/orders/-"),
      open ? `<div class="drawer-foot">${tool("Order", { icon: "plus", kind: "add", write: write("table", "add", "/orders/-", { invoices_id: Number(open.id), dish_id: Number(item.id) }) })}</div>` : `<p class="note">You can order once you are seated.</p>`,
    ), go("menu"), "item-drawer");
  return part;
}
