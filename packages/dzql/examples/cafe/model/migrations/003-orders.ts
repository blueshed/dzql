// An order names its table (`table`, kept as `table_id`), as a kitchen ticket does: the kitchen
// holds the orders alone, so each says where it goes. One ordered before says none.
import { addColumn } from "@blueshed/delta/migrations";

export const changes = [
  addColumn("orders", "table_id", { type: "integer", nullable: true }),
];
