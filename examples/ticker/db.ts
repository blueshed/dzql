import { migrate } from "../../src/migrate";
import { db } from "../../src/db";

// The ticker example's own migration, under its own namespace in the shared _migrations table.
// Every document module in this example imports `db` from here, never from ../../src/db, so the
// migration has run before any prepared statement (created at module load) touches the database.
migrate(db, `${import.meta.dir}/migrations`, "ticker");

export { db };
