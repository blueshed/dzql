import { defineDoc, defineSchema, registerDocs, type DocDef } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db, openTables } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";

// The ticker's store: SQLite (dzql/rendering/db), its documents in delta (`@blueshed/delta`). The
// market is never undone: ticked by the feed, or typed by anyone, recorded and never undone. A
// quote is one symbol of it, as its own document, so a board is told only the symbols it watches.
// A watchlist and a clock are a session's own, written by the person, and undoable. The desk --
// how the session reads the board and the market -- is the session's too, but nothing on it is
// anyone's doing: it is kept, and never on the ledger. Where a tab is on the page is the tab's own,
// kept in no table. All three are one row, the session's, each document holding its own columns of
// it: so the tables are said once, here, not in each resource's api, and made before any document
// is registered over them. Each resource registers its documents (`register`, in
// `resources/<name>/<name>-api.ts`). The tables are the ticker's own (`ticker_`), beside anything
// else in the database; every row is numbered, and a quote says its symbol.

/** The city a fresh clock shows: a column's default, so said with the tables (CLOCK_TZ, else Zurich). */
export const DEFAULT_TZ = process.env.CLOCK_TZ ?? "Europe/Zurich";

export const schema = defineSchema({
  markets: { table: "ticker_markets", columns: {} },
  quotes: { table: "ticker_quotes", parent: "markets", columns: { symbol: "text", name: "text", price: "real", prev: "real" }, temporal: false }, // prices tick many times a second: no history kept
  desks: {
    table: "ticker_desks",
    columns: {
      reading: "json?",
      filter: "json?",
      hide: "json?",
      // a fresh watchlist is empty and a fresh clock shows the default city, so taking back the
      // first write says so, not null
      symbols: { type: "json", nullable: true, default: [] },
      tz: { type: "text", nullable: true, default: DEFAULT_TZ },
      // the hash of the cookie that names the session (dzql/rendering/sessions), in none of its documents
      cookie: "text?",
    },
    temporal: false, // a visit is no history
  },
});

/** Its tables: its own migrations (./migrations), then what the schema says beyond them. */
export const migrating = await openTables(schema, "ticker", `${import.meta.dir}/migrations`);

export const delta = createLocal();

/** A resource's documents, on delta over the ticker's tables: on the ledger unless it says not. */
export const register = (docs: DocDef[], { ledger = true } = {}) => registerDocs(delta.server, db, schema, docs, [], { ledger });

// The session a cookie names, found and made by the cookie's hash, off the ledger: a visit is a desk.
register([defineDoc("visit:", { root: "desks", scope: { cookie: ":cookie" }, include: [] })], { ledger: false });
export const sessions = sessionRows(delta, "desks");

export { db };
