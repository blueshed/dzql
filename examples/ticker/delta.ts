import { createTables, defineDoc, defineSchema, registerDocs, migrate, fromFolder, migrateSchema } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "../../src/db";
import { DEFAULT_TZ } from "./documents/clock";

// The ticker's documents, in delta (`@blueshed/delta`). The market is a fact: ticked
// by the feed, or typed by anyone, recorded and never undone. A quote is one symbol of it, as its
// own document, so a board is told only the symbols it watches. A watchlist and a clock are a
// session's own, written by the person, and undoable. The desk -- where the session is on the
// page -- is the session's too, but nothing on it is anyone's doing: it is kept, and never on
// the ledger. The tables are the ticker's own (`ticker_`), beside anything else in the database.

export const schema = defineSchema({
  markets: { table: "ticker_markets", columns: {}, temporal: false },
  quotes: { table: "ticker_quotes", parent: "markets", columns: { name: "text", price: "real", prev: "real" }, temporal: false },
  // a fresh watchlist is empty and a fresh clock shows the default city, so taking back the first
  // write says so, not null
  watchlists: { table: "ticker_watchlists", columns: { symbols: { type: "json", nullable: true, default: [] } }, temporal: false },
  clocks: { table: "ticker_clocks", columns: { tz: { type: "text", nullable: true, default: DEFAULT_TZ } }, temporal: false },
  desks: { table: "ticker_desks", columns: { page: "text?", reading: "json?", filter: "json?", hide: "json?" }, temporal: false },
});

await migrate(db, await fromFolder(`${import.meta.dir}/migrations`)); // first, what the schema cannot say: a rename, a drop, data moved
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
db.run("INSERT OR IGNORE INTO ticker_markets (id) VALUES ('market')");
const open = db.query("INSERT OR IGNORE INTO ticker_quotes (id, markets_id, name, price, prev) VALUES (?, 'market', ?, ?, ?)");
for (const [symbol, name, price] of OPENING) open.run(symbol, name, price, price);

export const delta = createLocal();

registerDocs(
  delta.server,
  db,
  schema,
  [
    defineDoc("ticker:", { root: "markets", include: ["quotes"] }),
    // one quote, for a board that watches it: a tick on the market is told to it too (delta's fan-out)
    defineDoc("quote:", { root: "quotes", include: [] }),
    // a watchlist and a clock are there before their first write
    defineDoc("watchlist:", { root: "watchlists", include: [], implied: true }),
    defineDoc("clock:", { root: "clocks", include: [], implied: true }),
  ],
  [],
  { ledger: true },
);

// The desk, with no ledger: a visit is kept, and Undo never lands there.
registerDocs(delta.server, db, schema, [defineDoc("desk:", { root: "desks", include: [], implied: true })]);
