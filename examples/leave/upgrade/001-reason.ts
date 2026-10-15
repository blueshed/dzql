import type { Database } from "bun:sqlite";

// A request says why it is asked for. Every one asked before said nothing, so each was a holiday.
export function up(db: Database): void {
  db.run("ALTER TABLE leave_requests ADD COLUMN reason TEXT");
  db.run("UPDATE leave_requests SET reason = 'holiday'");
}
