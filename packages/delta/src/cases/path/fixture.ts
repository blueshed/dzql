/**
 * The one schema, documents and seed every path case runs over, the custom
 * documents beside them (each backend gives its own reads), and the rows as
 * a case builds them. Part of `pathCases` (`../path.ts`).
 */
import { defineDoc, defineSchema, type Snapshot, type TableDef } from "../../schema";

// ---------------------------------------------------------------------------
// The one schema, documents and seed
// ---------------------------------------------------------------------------

/**
 * A wedding and what hangs off it. households, courses and notes are children
 * of the wedding; drinks are grandchildren (children of a course); tags have
 * no parent, so every document that includes them holds all of them; notes are
 * temporal (a remove closes the row; its history stays); seats carry the other
 * column types: an integer, a boolean and a json column. A household's `t` is
 * named as the write SQL once named its row: a column may take any name.
 */
export const pathSpec: Record<string, TableDef> = {
  weddings: { table: "fo_weddings", columns: { name: "text" }, temporal: false },
  households: { table: "fo_households", parent: "weddings", columns: { email: "text", t: "text?" }, temporal: false },
  courses: { table: "fo_courses", parent: "weddings", columns: { name: "text" }, temporal: false },
  drinks: { table: "fo_drinks", parent: "courses", columns: { name: "text" }, temporal: false },
  tags: { table: "fo_tags", columns: { label: "text" }, temporal: false },
  notes: { table: "fo_notes", parent: "weddings", columns: { text: "text" }, temporal: true },
  seats: { table: "fo_seats", parent: "weddings", columns: { table_no: "integer", kept: "boolean", wishes: "json?" }, temporal: false },
  // the time slots of a wedding: the scopes on a real, a parent key and a time
  slots: { table: "fo_slots", parent: "weddings", columns: { price: "real?", starts: "timestamptz?" }, temporal: false },
  // a favour for a household: a child of the wedding that goes with its household too (cascadeOn), so a
  // wedding's removal reaches it twice -- as the wedding's child, and through the household
  favours: { table: "fo_favours", parent: "weddings", columns: { households_id: "integer", gift: "text" }, cascadeOn: ["households_id"], temporal: false },
  // a wedding's asks, named in SQL's own words: the table, its parent key and its columns are keywords
  asks: { table: "order", parent: { collection: "weddings", fk: "group" }, columns: { in: "integer?", from: "text?", to: "text?" }, temporal: true },
};
export const pathSchema = defineSchema(pathSpec);

/** Several documents over the same rows, cut different ways. */
export const pathDocs = [
  // the couple's board: everything under the wedding
  defineDoc("fo-board:", { root: "weddings", include: ["households", "courses", "drinks", "tags", "notes"] }),
  // the caterer's menu: the courses and their drinks
  defineDoc("fo-menu:", { root: "weddings", include: ["courses", "drinks"] }),
  // one household's own document: the row is the root
  defineDoc("fo-household:", { root: "households", include: [] }),
  // one course, with its drinks: a child row as the root, a grandchild as its child
  defineDoc("fo-course:", { root: "courses", include: ["drinks"] }),
  // the wedding's name alone: the root, and none of the children
  defineDoc("fo-title:", { root: "weddings", include: [] }),
  // the shared tags beside a wedding
  defineDoc("fo-tagged:", { root: "weddings", include: ["tags"] }),
  // the notes beside a wedding (temporal)
  defineDoc("fo-notes:", { root: "weddings", include: ["notes"] }),
  // list mode: every course; and the courses whose name starts with the doc's id
  defineDoc("fo-all-courses:", { root: "courses", include: [] }),
  // list mode with an include: every course, and every drink
  defineDoc("fo-catalog:", { root: "courses", include: ["drinks"] }),
  // list mode with a temporal include: every course, and every note
  defineDoc("fo-courses-noted:", { root: "courses", include: ["notes"] }),
  defineDoc("fo-courses-like:", { root: "courses", include: [], scope: { name: "like:start" } }),
  // ... and with their drinks: a drink goes only under a course the list holds
  defineDoc("fo-menu-like:", { root: "courses", include: ["drinks"], scope: { name: "like:start" } }),
  // list mode by an equality: the tags of one label, which a tag added through it is given
  defineDoc("fo-tags-labelled:", { root: "tags", include: [], scope: { label: ":label" } }),
  // the seating plan: the wedding and its seats
  defineDoc("fo-seating:", { root: "weddings", include: ["seats"] }),
  // list mode by a boolean: the seats kept (1) or not (0), which a seat added through it is given
  defineDoc("fo-seats-kept:", { root: "seats", include: [], scope: { kept: ":kept" } }),
  // list mode by the other column types: a boolean's range, and an integer
  defineDoc("fo-seats-upto:", { root: "seats", include: [], scope: { kept: "<=:kept" } }),
  defineDoc("fo-seats-at:", { root: "seats", include: [], scope: { table_no: ":table" } }),
  // list mode by a json column: the seats whose wishes are the name read as JSON, which a seat added through it is given
  defineDoc("fo-seats-wished:", { root: "seats", include: [], scope: { wishes: ":wishes" } }),
  // list mode by a real's range: the slots that cost at most the name
  defineDoc("fo-slots-upto:", { root: "slots", include: [], scope: { price: "<=:max" } }),
  // list mode by a parent key: a wedding's slots, and those of the weddings up to one
  defineDoc("fo-slots-of:", { root: "slots", include: [], scope: { weddings_id: ":wedding" } }),
  defineDoc("fo-slots-under:", { root: "slots", include: [], scope: { weddings_id: "<=:most" } }),
  // list mode by a time: the slots that start by a date, and those that start on its midnight
  defineDoc("fo-slots-by:", { root: "slots", include: [], scope: { starts: "<=:end" } }),
  defineDoc("fo-slots-on:", { root: "slots", include: [], scope: { starts: ":on" } }),
  // a temporal row as the root: one note, and every note
  defineDoc("fo-note:", { root: "notes", include: [] }),
  defineDoc("fo-all-notes:", { root: "notes", include: [] }),
  // the wedding's drinks, without the courses they hang from: held through them all the same
  defineDoc("fo-drinks:", { root: "weddings", include: ["drinks"] }),
  // one course and the households, which hang from the wedding: a chain that meets no course, so none of them
  defineDoc("fo-course-guests:", { root: "courses", include: ["households"] }),
  // a wedding being planned: there before its row is, which its first write makes (implied)
  defineDoc("fo-plan:", { root: "weddings", include: ["courses", "drinks"], implied: true }),
  // list mode: every wedding and its courses -- the kitchen's view, which a plan's first write adds a wedding to
  defineDoc("fo-weddings:", { root: "weddings", include: ["courses"] }),
  // single mode with a second condition: one household by its id and its email, one seat by its id and its table
  defineDoc("fo-guest:", { root: "households", include: [], scope: { id: ":id", email: ":email" } }),
  defineDoc("fo-seat-of:", { root: "seats", include: [], scope: { id: ":id", table_no: ":table" } }),
  // list mode: every household, whichever wedding -- the document a household moves between weddings through
  defineDoc("fo-all-households:", { root: "households", include: [] }),
  // the party: the wedding, its households and their favours
  defineDoc("fo-party:", { root: "weddings", include: ["households", "favours"] }),
  // the party, slim: a household's email and a seat's table, each with its id and parent key, and nothing else of them
  defineDoc("fo-slim:", { root: "weddings", include: ["households", "seats"], columns: { households: ["email"], seats: ["table_no"] } }),
  // a time in the name (at:): the document as it stood then -- the notes, the courses and every note, a wedding and its notes
  defineDoc("fo-notes-on:", { root: "notes", include: [], scope: { at: "at:when" } }),
  defineDoc("fo-courses-noted-on:", { root: "courses", include: ["notes"], scope: { at: "at:when" } }),
  defineDoc("fo-board-on:", { root: "weddings", include: ["notes"], scope: { id: ":id", at: "at:when" } }),
  // the asks under a wedding, and those from one person (list mode by a keyword): names SQL keeps for itself
  defineDoc("fo-asks:", { root: "weddings", include: ["asks"] }),
  defineDoc("fo-asks-from:", { root: "asks", include: [], scope: { from: ":from" } }),
];

/**
 * Documents an app registers apart, over the same rows: on SQLite
 * and the JSON file a second `registerDocs` on the same server and database --
 * a public set beside the private one, keeping no ledger -- and on Postgres
 * beside the rest, as one registry is all it has.
 */
export const pathPublicDocs = [defineDoc("fo-pub-courses:", { root: "courses", include: [] })];

/**
 * A custom document (`defineCustomDoc`, membership) beside them: the
 * households of one email, told of a write to a household row whichever
 * document it came through. Only the first read differs by backend (SQLite and
 * the JSON file read their database, Postgres its pool): a backend gives its
 * read to `inboxDoc`, and the rest is the same.
 */
export const inboxDoc = <Q>(query: Q) => ({
  prefix: "fo-inbox:",
  watch: ["households"],
  parse: (email: string) => email,
  query,
  matches: (_coll: string, row: any, email: string) => row.email === email,
});
const householdsTable = pathSchema.tables.households!.name;
export const sqliteInbox = inboxDoc((db: any, email: string) => ({ households: db.query(`SELECT * FROM ${householdsTable} WHERE email = ?`).all(email) }));

/**
 * Membership documents whose query reads some columns of a row, as a view
 * often does: a wedding's guests' emails (`fo-emails:`), and the same with
 * its keys read as text (`fo-guests:`, `id::text`, as the skill's bbox does).
 * A view is told what changed of what it holds, in the shape its query gave.
 */
const membersOf = <Q>(prefix: string, query: Q) => ({
  prefix,
  watch: ["households"],
  parse: (wedding: string) => wedding,
  query,
  matches: (_coll: string, row: any, wedding: string) => String(row.weddings_id) === wedding,
});
/** How often fo-emails:'s query has run, and how long it is made to take (ms): what a case asks of a view's reads. */
export const emailsQuery = { runs: 0, delay: 0 };
const slowed = <R>(read: () => R | Promise<R>): R | Promise<R> => {
  emailsQuery.runs++;
  if (!emailsQuery.delay) return read();
  const rows = read();   // read as the query runs, answered late
  return Bun.sleep(emailsQuery.delay).then(() => rows);
};
/** fo-emails: over a backend's read, counted and slowed as `emailsQuery` says. */
export const emailsDoc = <Q extends (...args: any[]) => any>(read: Q) =>
  membersOf("fo-emails:", ((...args: any[]) => slowed(() => read(...args))) as Q);
/** fo-guests: over a backend's read, its keys read as text. */
export const guestsDoc = <Q>(read: Q) => membersOf("fo-guests:", read);
// slowed, the SQLite query answers a promise, as the backend takes it (its type says a value)
export const sqliteEmails = emailsDoc((db: any, w: string) => ({ households: db.query(`SELECT id, email FROM ${householdsTable} WHERE weddings_id = ?`).all(Number(w)) as any[] }) as { households: any[] });
export const sqliteGuests = guestsDoc((db: any, w: string) => ({
  households: db.query(`SELECT CAST(id AS TEXT) AS id, CAST(weddings_id AS TEXT) AS weddings_id, email FROM ${householdsTable} WHERE weddings_id = ?`).all(Number(w)),
}));

/**
 * A custom document whose prefix starts with a list's: the seats not kept,
 * named fo-seats-at:open:<anything>. Its name is its own, never the list
 * fo-seats-at: read with "open" for a table number.
 */
export const openSeatsDoc = <Q>(query: Q) => ({
  prefix: "fo-seats-at:open:",
  watch: ["seats"],
  parse: (name: string) => name,
  query,
  matches: (_coll: string, row: any) => row.kept === false,
});
const seatsTable = pathSchema.tables.seats!.name;
// each row as a document reads it: SQLite keeps a boolean as 0 or 1 and json as its text
export const sqliteOpenSeats = openSeatsDoc((db: any) => ({
  seats: db.query(`SELECT * FROM ${seatsTable} WHERE kept = 0`).all().map((r: any) => ({ ...r, kept: r.kept === 1, wishes: r.wishes === null ? null : JSON.parse(r.wishes) })),
}));

/**
 * A recompute custom document beside them: the wedding's menu card,
 * its name and its courses' names in order -- a shape no per-row predicate
 * gives -- read whole on open and again on every write to what it watches,
 * told as a root replace. Only the read differs by backend.
 */
export const menuCardDoc = <R>(recompute: R) => ({
  prefix: "fo-menu-card:",
  watch: ["weddings", "courses"],
  parse: (id: string) => Number(id),
  recompute,
});
const weddingsTable = pathSchema.tables.weddings!.name;
const coursesTable = pathSchema.tables.courses!.name;
export const sqliteMenuCard = menuCardDoc((db: any, id: number) => {
  const wedding = db.query(`SELECT name FROM ${weddingsTable} WHERE id = ?`).get(id) as { name: string } | null;
  if (!wedding) return null;
  return { wedding: wedding.name, courses: (db.query(`SELECT name FROM ${coursesTable} WHERE weddings_id = ? ORDER BY id`).all(id) as { name: string }[]).map((c) => c.name) };
});

/** Rows as every backend is seeded with them, through `importTables`. Wedding 2 is the bystander. The temporal note began long ago. */
export const pathSeed: Snapshot = {
  tables: {
    weddings: [{ id: 1, name: "ours" }, { id: 2, name: "theirs" }],
    households: [{ id: 1, weddings_id: 1, email: "a@x" }, { id: 2, weddings_id: 1, email: "b@x" }, { id: 3, weddings_id: 2, email: "c@x" }],
    courses: [{ id: 1, weddings_id: 1, name: "Soup" }, { id: 2, weddings_id: 2, name: "Salad" }],
    drinks: [{ id: 1, courses_id: 1, name: "Sherry" }, { id: 2, courses_id: 2, name: "Water" }],
    tags: [{ id: 1, label: "red" }],
    notes: [{ id: 1, weddings_id: 1, text: "bring chairs", valid_from: "2020-01-01T00:00:00.000Z", valid_to: null }],
    seats: [{ id: 1, weddings_id: 1, table_no: 3, kept: true, wishes: { veg: true } }],
    favours: [{ id: 1, weddings_id: 1, households_id: 1, gift: "jam" }],
  },
};

/** Rows as a fresh open reads them. */
export const course = (id: number, name: string, wedding = 1) => ({ id, weddings_id: wedding, name });
export const drink = (id: number, courseId: number, name: string) => ({ id, courses_id: courseId, name });
export const household = (id: number, email: string, wedding = 1, t: string | null = null) => ({ id, weddings_id: wedding, email, t });
export const seat = (id: number, tableNo: number, kept: boolean, wishes: unknown = null, wedding = 1) => ({ id, weddings_id: wedding, table_no: tableNo, kept, wishes });
/** A field as a holder is told it changed: a replace of the field alone. */
export const field = (path: string, value: unknown) => ({ op: "replace", path, value });
