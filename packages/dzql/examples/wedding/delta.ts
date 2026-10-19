import { createTables, defineDoc, defineSchema, registerDocs, migrate, fromFolder, migrateSchema } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import { db } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";
import type { Declared } from "dzql/rendering/derive";

// The wedding's documents, in delta (`@blueshed/delta`). One set of tables, seen as
// several documents, each cut for who reads it:
//
// - `board:<wedding>` -- the couple's: the wedding and everything beneath it, every household whole.
// - `household:<id>` -- a household's own: its answer, its guests (each wearing a minifigure, with
//   their choices), its asks, its claims.
// - `wedding:<wedding>` -- what every household reads of the wedding: the day, and the lists.
// - `welcome:<wedding>` -- what a visitor without a code reads: the wedding's own row, no more.
// - `everyone:<wedding>` -- live, kept by the server (../everyone.ts): who stands in the photo, and
//   how many have claimed each gift. What households see of each other, and no more.
// - `session:<id>` -- a visit: who the session is (a code) and where it is. Kept, never on the ledger.
//   A visit is a numbered row; its cookie is a random token whose hash the row keeps (`visit:`).
//
// A write to one reaches the others that share its rows (delta's fan-out): the couple's reply
// reaches the household's own document, and a household's answer reaches the board. The couple's
// code is in a table of its own, in no document: every household reads the wedding's row.

const LOOK_DEFAULTS = { skin: "#F2C86A", hair: "none", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "smile", attitude: "nodding" };
const withDefault = (type: "text" | "integer", value: unknown) => ({ type, nullable: false, default: value }) as never;

export const schema = defineSchema({
  weddings: {
    table: "wedding_weddings",
    columns: { day: "text", deadline: "text?", name1: "text", name2: "text", venue: "text?", message: "text?", picture_key: "text?" },
    temporal: false,
  },
  couples: { table: "wedding_couples", parent: "weddings", columns: { code: "text" }, temporal: false },
  households: {
    table: "wedding_households",
    parent: "weddings",
    columns: { code: "text", email: "text", plus_ones: withDefault("integer", 0), answer: "text?", message: "text?" },
    temporal: false,
  },
  guests: {
    table: "wedding_guests",
    parent: "households",
    columns: {
      name: "text",
      named_by: withDefault("text", "couple"),
      coming: "integer?",
      // the minifigure, one each, blank until built (built_at null)
      ...Object.fromEntries(Object.entries(LOOK_DEFAULTS).map(([field, value]) => [field, withDefault("text", value)])),
      built_at: "text?",
      // by course id: the dish and the drink chosen; delta fills in {} on a new row (SQL can't)
      choices: { type: "json", nullable: true, default: {} } as never,
    },
    temporal: false,
  },
  asks: { table: "wedding_asks", parent: "households", columns: { name: "text", asked_at: "text", reply: "text?", guest_id: "integer?" }, temporal: false },
  claims: { table: "wedding_claims", parent: "households", columns: { gift_id: "integer", claimed_at: "text" }, temporal: false },
  courses: { table: "wedding_courses", parent: "weddings", columns: { name: "text", seq: "integer" }, temporal: false },
  dishes: { table: "wedding_dishes", parent: "courses", columns: { name: "text", dietary: "text?", seq: "integer" }, temporal: false },
  drinks: { table: "wedding_drinks", parent: "courses", columns: { name: "text", seq: "integer" }, temporal: false },
  gifts: {
    table: "wedding_gifts",
    parent: "weddings",
    columns: { name: "text", description: "text?", link: "text?", picture_key: "text?", seq: "integer", shared: withDefault("integer", 0) },
    temporal: false,
  },
  events: { table: "wedding_events", parent: "weddings", columns: { name: "text", when_at: "text?", where_at: "text?", notes: "text?", seq: "integer" }, temporal: false },
  places: { table: "wedding_places", parent: "weddings", columns: { name: "text", notes: "text?", link: "text?", picture_key: "text?", seq: "integer" }, temporal: false },
  // the venues the couple are choosing between: a page nobody wrote, drawn from these columns (`derived`, below)
  venues: { table: "wedding_venues", parent: "weddings", columns: { name: "text", notes: "text?", picture_key: "text?" }, temporal: false },
  visits: {
    table: "wedding_visits",
    columns: { code: "text?", page: "text?", reading: "json?", filter: "json?", hide: "json?", note: "text?", cookie: "text?" },
    temporal: false,
  },
});

/** Whose migrations these are, and its schema: the examples may share a database, and each runs only its own. */
export const migrating = { app: "wedding", schema };
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), migrating); // first, what the schema cannot say: a rename, a drop, data moved
createTables(db, schema);
migrateSchema(db, schema);

// A gift that is not shared takes one claim: the store refuses a second, so it is the store that
// says "taken" when two households claim at once.
db.run(`CREATE TRIGGER IF NOT EXISTS wedding_one_claim BEFORE INSERT ON wedding_claims BEGIN
  SELECT RAISE(ABORT, 'taken: this gift is already claimed')
  WHERE (SELECT shared FROM wedding_gifts WHERE id = NEW.gift_id) = 0 AND EXISTS (SELECT 1 FROM wedding_claims WHERE gift_id = NEW.gift_id);
END`);

// The pictures the couple keep, by key: bytes beside everything else, served by ../routes.ts.
// Not a document: the key that lands on a row is.
db.run("CREATE TABLE IF NOT EXISTS wedding_pictures (key TEXT PRIMARY KEY, type TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL)");

if (!db.query("SELECT 1 FROM wedding_weddings").get()) db.run(await Bun.file(`${import.meta.dir}/seed.sql`).text());

export const delta = createLocal();

/** The couple's collections drawn from their shape (src/rendering/derive.ts): what each says beyond its columns. Text columns only: the board's shape takes them as text. */
export const derived: Record<string, Declared> = {
  venues: { noun: "venue", fields: { picture_key: { label: "Picture", applet: "picture-field" } } },
};

const LISTS = ["courses", "dishes", "drinks", "gifts", "events", "places"];

registerDocs(
  delta.server,
  db,
  schema,
  [
    defineDoc("board:", { root: "weddings", include: ["households", "guests", "asks", "claims", ...LISTS, "venues"] }),
    defineDoc("household:", { root: "households", include: ["guests", "asks", "claims"] }),
    defineDoc("wedding:", { root: "weddings", include: LISTS }),
    defineDoc("welcome:", { root: "weddings", include: [] }),
  ],
  [],
  { ledger: true },
);

// A visit, with no ledger: which page a tab is on is not the wedding's history. A visit is a numbered
// row, found by its cookie's hash through `visit:` (dzql/rendering/sessions), which `session:` never holds.
registerDocs(delta.server, db, schema, [
  defineDoc("session:", { root: "visits", include: [], implied: true, columns: { visits: ["code", "page", "reading", "filter", "hide", "note"] } }),
  defineDoc("visit:", { root: "visits", scope: { cookie: ":cookie" }, include: [] }),
]);

/** The visits, a row each, named by the cookie a browser carries. */
export const sessions = sessionRows(delta, "visits");

/** Who stands in the photo, and how many have claimed each gift: `everyone:<wedding>`. */
registerMemory(delta.server, { prefix: "everyone:", empty: () => ({ figures: {}, taken: {} }) });

export { db };
