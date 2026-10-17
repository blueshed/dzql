import type { Database } from "bun:sqlite";
import { renameColumn } from "@blueshed/delta/sqlite";

// Who asked is the request's person: `asked_by` is `person_id`, as a session says it.
export function up(db: Database): void {
  renameColumn(db, "leave_requests", "asked_by", "person_id");
}
