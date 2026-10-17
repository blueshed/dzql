import type { Database } from "bun:sqlite";
import { dropColumn } from "@blueshed/delta/sqlite";

// How many days a request is, the calendar works out (working days, not every day): the count kept goes.
export function up(db: Database): void {
  dropColumn(db, "leave_requests", "days");
}
