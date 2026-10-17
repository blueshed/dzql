import { createTables, defineDoc, defineSchema, registerDocs, migrate, fromFolder, migrateSchema } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";
import { DEFAULT_TZ } from "./documents/clock";

// The ticker's documents, in delta (`@blueshed/delta`). The market is never undone: ticked
// by the feed, or typed by anyone, recorded and never undone. A quote is one symbol of it, as its
// own document, so a board is told only the symbols it watches. A watchlist and a clock are a
// session's own, written by the person, and undoable. The desk -- where the session is on the
// page -- is the session's too, but nothing on it is anyone's doing: it is kept, and never on
// the ledger. All three are one row, the session's, each document holding its own columns of it.
// The tables are the ticker's own (`ticker_`), beside anything else in the database; every row is
// numbered, and a quote says its symbol.

export const schema = defineSchema({
  markets: { table: "ticker_markets", columns: {}, temporal: false },
  quotes: { table: "ticker_quotes", parent: "markets", columns: { symbol: "text", name: "text", price: "real", prev: "real" }, temporal: false },
  desks: {
    table: "ticker_desks",
    columns: {
      page: "text?",
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
    temporal: false,
  },
});

/** Whose migrations these are, and its schema: the examples may share a database, and each runs only its own. */
export const migrating = { app: "ticker", schema };
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), migrating); // first, what the schema cannot say: a rename, a drop, data moved
createTables(db, schema);
migrateSchema(db, schema);

// The market as it opens: made-up names, made-up prices, so nothing here is anyone's advice.
const OPENING: [string, string, number][] = [
  ["ALPH", "Alpha Systems", 189.42],
  ["BRVO", "Bravo Foods", 64.1],
  ["CHRL", "Charlie Metals", 12.87],
  ["DLTA", "Delta Shipping", 231.05],
  ["ECHO", "Echo Networks", 41.66],
  ["FXTR", "Foxtrot Energy", 98.3],
  ["GOLF", "Golf Leisure", 27.15],
  ["HOTL", "Hotel Holdings", 155.8],
  ["INDA", "India Textiles", 8.92],
  ["JULT", "Juliet Pharma", 312.44],
  ["KILO", "Kilo Freight", 73.21],
  ["LIMA", "Lima Water", 19.48],
  ["MIKE", "Mike Semiconductors", 402.77],
  ["NOVA", "November Air", 56.09],
  ["OSCR", "Oscar Media", 33.6],
  ["PAPA", "Papa Retail", 121.15],
];
db.run("INSERT OR IGNORE INTO ticker_markets (id) VALUES (1)");
const open = db.query("INSERT INTO ticker_quotes (id, markets_id, symbol, name, price, prev) SELECT ?1, 1, ?2, ?3, ?4, ?4 WHERE NOT EXISTS (SELECT 1 FROM ticker_quotes WHERE symbol = ?2)");
OPENING.forEach(([symbol, name, price], i) => open.run(i + 1, symbol, name, price));

export const delta = createLocal();

registerDocs(
  delta.server,
  db,
  schema,
  [
    defineDoc("ticker:", { root: "markets", include: ["quotes"] }),
    // one quote, for a board that watches it: a tick on the market is told to it too (delta's fan-out)
    defineDoc("quote:", { root: "quotes", include: [] }),
    // a watchlist and a clock: the session's row, by the columns each holds
    defineDoc("watchlist:", { root: "desks", include: [], columns: { desks: ["symbols"] } }),
    defineDoc("clock:", { root: "desks", include: [], columns: { desks: ["tz"] } }),
  ],
  [],
  { ledger: true },
);

// The desk, with no ledger: a visit is kept, and Undo never lands there. And the session a cookie
// names, found and made by the cookie's hash.
registerDocs(delta.server, db, schema, [
  defineDoc("desk:", { root: "desks", include: [], columns: { desks: ["page", "reading", "filter", "hide"] } }),
  defineDoc("visit:", { root: "desks", scope: { cookie: ":cookie" }, include: [] }),
]);
export const sessions = sessionRows(delta, "desks");
