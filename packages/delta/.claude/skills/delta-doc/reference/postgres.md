# Moving on to Postgres: dzql

SQLite is delta's last step of its own. Move on when servers share the data (each process told
live of another's writes). That step is **dzql**: delta's documents compiled into Postgres,
answering the same wire and the same cases (`testing.md`).

The app keeps its definitions (`defineSchema` and `defineDoc` from delta), its client, its
migrations and each document's `owns`. What changes is the server's storage:

```ts
import { openStore } from "dzql/postgres";

// the same history as on SQLite makes the tables; DATABASE_URL's server, else PGlite in this process
const store = await openStore({ schema, migrations: { dir: "migrations", app: "board", schema }, ws });
store.register(docs);
await store.open();   // each document compiled, then served on `ws`; `store.close` on shutdown
```

Carry the rows with `exportTables` / `importTables` (`backends.md`). Link sign-in keeps its links
and sessions in Postgres with dzql's `postgresLinkStore` (`dzql/auth-link`). From a shell,
`dzql sql` writes the app's SQL, `dzql init` vendors the framework SQL, `dzql migrate` runs the
migrations and `dzql link` prints someone's sign-in link.

dzql's own docs (`docs/postgres/postgres.md` in blueshed/dzql) say what Postgres adds: a server or
PGlite in the process (for tests), what is compiled, row-level security, and calling the stored
functions from SQL.
