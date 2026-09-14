import { migrate } from "../../src/migrate";
import { db } from "../../src/db";

// The wedding example's own migrations (the wedding's tables, then the demo seed), run under
// their own namespace so their filenames can't collide with the kernel's or another example's in
// the shared _migrations table. Every document module in this example imports `db` from here,
// never from ../../src/db directly, so these migrations are guaranteed to have run before any of
// this example's prepared statements (created at module load) touch the database.
migrate(db, `${import.meta.dir}/migrations`, "wedding");

// The schema leans on ON DELETE CASCADE (a household's guests, a guest's minifigure and choices)
// and on composite foreign keys (a choice's dish belongs to the choice's course). SQLite enforces
// none of it unless asked, per connection, so ask here -- after the migrations, which set it for
// their own run but leave a database that already had them applied without it.
db.run("PRAGMA foreign_keys = ON");

export { db };
