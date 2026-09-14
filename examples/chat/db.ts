import { migrate } from "../../src/migrate";
import { db } from "../../src/db";

// The chat example's own migrations (sessions, rooms), run under its own
// namespace so its filenames can't collide with the kernel's or another
// example's in the shared _migrations table. Every document module in this
// example imports `db` from here, never from ../../src/db directly, so
// these migrations are guaranteed to have run before any of this example's
// prepared statements (created at module load) touch the database.
// `legacy`: before 0.21.0 these lived in the kernel's migrations/ as 0002
// and 0003, recorded without a namespace; a dev database from then is
// adopted rather than failing on a second CREATE TABLE.
migrate(db, `${import.meta.dir}/migrations`, "chat", {
  "0002_sessions.sql": "0001_sessions.sql",
  "0003_rooms.sql": "0002_rooms.sql",
});

export { db };
