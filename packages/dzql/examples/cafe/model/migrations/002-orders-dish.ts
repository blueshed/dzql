// An order names its dish (`dish`, kept as `dish_id`) and keeps its surrogate beside it: the name and
// the price it was ordered at, copied as it is written, shown once the dish is off the menu. The
// copy it kept before (`item`, `price`) is that surrogate, renamed, so no order loses what it said.
import { addColumn, renameColumn } from "@blueshed/delta/migrations";

export const changes = [
  renameColumn("orders", "item", "dish_name"),
  renameColumn("orders", "price", "dish_price"),
  addColumn("orders", "dish_id", { type: "integer", nullable: true }),
];
