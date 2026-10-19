import { createTables, defineDoc, defineSchema, registerDocs, migrate, fromFolder, migrateSchema } from "@blueshed/delta/sqlite";
import * as json from "@blueshed/delta/json";
import { existsSync } from "node:fs";
import { createLocal } from "@blueshed/delta/local";
import { Database } from "bun:sqlite";
import { db as appDb } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";

// modeling's documents, in delta (`@blueshed/delta`). A model is one document, written by the two
// who keep it and on the ledger: its stories -- each with who tells it, whether they do it or are
// refused, a route it posts to, the entities it touches, and, as hjeli had them, what it writes and
// the states it presupposes -- and the documents they need -- each
// with its root, what it holds (an entity at a time: what it hangs under, its fields), who holds
// it, whether it is each person's own or lists every row of its root, and which stories it serves. The entities are worked out
// from those (./heart.ts), never kept. A session is who you are; it is signed in by the sign-in
// page (./signin.ts) and kept off the ledger. How someone signs in is a table no document
// includes, so no hash crosses the wire. The tables are modeling's own (`mdl_`).

export const schema = defineSchema({
  models: { table: "mdl_models", columns: { name: "text" } },
  stories: { table: "mdl_stories", parent: "models", columns: { text: "text", actor: "text", kind: "text", post: "text?", touches: "json", writes: "json?", requires: "json?" } },
  documents: { table: "mdl_documents", parent: "models", columns: { name: "text", root: "text", own: "integer", list: "integer?", holds: "json", held_by: "json", stories: "json" } },
  people: { table: "mdl_people", columns: { name: "text" } },
  sessions: { table: "mdl_sessions", columns: { person_id: "integer?", name: "text?", cookie: "text?" }, temporal: false }, // a visit is no history
  logins: { table: "mdl_logins", columns: { person_id: "integer", email: "text", hash: "text" }, temporal: false }, // a credential's old versions are only a risk
});

// Beside an app (`MODEL_FILE`: the model is its file), the model keeps nothing in the app's
// database: its sessions and sign-ins are in memory. On its own, as an example, the database is its.
// Kept on globalThis, so `bun --hot` running the modules again (the app beside it reloads as the model
// writes its types) keeps who is signed in: a browser's cookie still names its session.
const kept = globalThis as { __dzqlModelDb?: Database };
const db = process.env.MODEL_FILE ? (kept.__dzqlModelDb ??= new Database(":memory:")) : appDb;

/** Whose migrations these are, and its schema: the examples may share a database, and each runs only its own. */
export const migrating = { app: "modeling", schema };
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), migrating); // first, what the schema cannot say: a rename, a drop, data moved
createTables(db, schema);
migrateSchema(db, schema);

// The two who keep a model, and the model as it starts. Here, in eta: Peter and Claude, each with a
// password made up for the example (a login is found by its email, `peter@modeling.example`), and
// leave's model, as the modeller read it from leave's code and a run of its 23 stories -- the team
// and each person's session, and the logins a sign-in looks up. In a project made with `bun create
// blueshed/eta`, its `.env` says otherwise: `MODEL_NAME`, the project's own model, empty;
// `MODEL_PEOPLE`, who keeps it; `MODEL_PASSWORD`, the one password they share.
const NAME = process.env.MODEL_NAME;
const PEOPLE = (process.env.MODEL_PEOPLE ?? "Peter,Claude").split(",").map((p) => p.trim()).filter(Boolean);
const passwordOf = (login: string) => process.env.MODEL_PASSWORD ?? `${login}-password`;
type Seeded = [actor: string, kind: "does" | "cannot", text: string, touches: string[], post?: string];
const STORIES: Seeded[] = [
  ["ann", "does", "Ann drags across two days in Bo's week, and sees the clash before she asks", ["sessions"]],
  ["ann", "does", "Ann asks for her draft, and Mo and Bo see it waiting on the calendar", ["requests"]],
  ["ann", "cannot", "Ann sets her draft's last day before its first, and is told so", ["sessions"]],
  ["bo", "cannot", "Bo asks for a draft that is only a weekend, and is told it has no working days", ["requests"]],
  ["ann", "does", "Ann drags her day in November to the Friday after, and Mo and Bo see it move", ["requests"]],
  ["bo", "does", "Bo takes back his week in October before Mo has answered", ["requests"]],
  ["mo", "does", "Mo asks for two days in November, and as the manager they are approved at once, by him", ["requests"]],
  ["mo", "does", "Mo moves the week he approved for himself, and the team sees it move", ["requests"]],
  ["mo", "does", "Mo takes back the week he approved for himself", ["requests"]],
  ["mo", "does", "Mo approves Bo's week from its drawer, and Bo sees it approved", ["requests"]],
  ["mo", "does", "Mo declines Ann's day in November, and Ann sees it declined", ["requests"]],
  ["ann", "cannot", "Ann cannot approve her own day off", ["requests"]],
  ["ann", "cannot", "Only a manager answers: Ann cannot approve Bo's week", ["requests"]],
  ["ann", "cannot", "Ann cannot move Bo's week", ["requests"]],
  ["ann", "cannot", "Ann cannot move days Mo has already approved", ["requests"]],
  ["ann", "cannot", "Ann cannot take back Mo's week", ["requests"]],
  ["ann", "cannot", "Ann cannot take back Bo's request", ["requests"]],
  ["visitor", "cannot", "A visitor who has not signed in cannot ask for leave", ["requests"]],
  ["ann", "cannot", "Ann cannot make herself a manager", ["people"]],
  ["ann", "cannot", "Ann cannot become Mo over the wire", ["sessions"]],
  ["visitor", "does", "Bo signs in on another phone, and sees the team's calendar", ["logins"], "/login"],
  ["visitor", "cannot", "Someone types Bo's email with the wrong password, and is told the two do not match", ["logins"], "/login"],
  ["ann", "does", "Ann signs out, and her page asks her to sign in", ["sessions"]],
];
const field = (name: string, type = "text") => ({ name, type });
const ids = (...n: number[]) => JSON.stringify(n);

if (!db.query("SELECT 1 FROM mdl_models").get()) {
  PEOPLE.forEach((name, i) => {
    const login = name.toLowerCase();
    db.run("INSERT INTO mdl_people (id, name) VALUES (?, ?)", [i + 1, name]);
    db.run("INSERT INTO mdl_logins (id, person_id, email, hash) VALUES (?, ?, ?, ?)", [i + 1, i + 1, `${login}@modeling.example`, Bun.password.hashSync(passwordOf(login))]);
  });
  db.run("INSERT INTO mdl_models (id, name) VALUES (1, ?)", [NAME ?? "Leave"]);
  (NAME ? [] : STORIES).forEach(([actor, kind, text, touches, post], i) =>
    db.run("INSERT INTO mdl_stories (id, models_id, text, actor, kind, post, touches) VALUES (?, 1, ?, ?, ?, ?, ?)", [i + 1, text, actor, kind, post ?? null, JSON.stringify(touches)]),
  );
  const team = {
    teams: { parent: null, fields: [field("name")] },
    people: { parent: "teams", fields: [field("name"), field("role")] },
    requests: { parent: "teams", fields: [field("person_id"), field("starts", "date"), field("ends", "date"), field("status"), field("answered_by")] },
  };
  const session = { sessions: { parent: null, fields: [field("person_id"), field("page"), field("draft", "json")] } };
  if (!NAME) db.run("INSERT INTO mdl_documents (id, models_id, name, root, own, holds, held_by, stories) VALUES (1, 1, 'team', 'teams', 0, ?, ?, ?), (2, 1, 'session', 'sessions', 1, ?, ?, ?)", [
    JSON.stringify(team),
    JSON.stringify(["ann", "bo", "mo"]),
    ids(2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19),
    JSON.stringify(session),
    JSON.stringify(["ann", "bo", "mo", "visitor"]),
    ids(1, 3, 20, 23),
  ]);
}

export const delta = createLocal();

const model = [defineDoc("model:", { root: "models", include: ["stories", "documents"] })];
// In a project, the model is a file in the app (`MODEL_FILE`, `dzql model`'s `model.json`): delta's
// JSON file, which a person can read and the page edits, its undo kept in it. Sessions stay here.
const MODEL_FILE = process.env.MODEL_FILE;
if (MODEL_FILE) {
  if (!existsSync(MODEL_FILE)) json.importTables(MODEL_FILE, schema, { tables: { models: [{ id: 1, name: NAME ?? "Model" }] } });
  json.registerDocs(delta.server, MODEL_FILE, schema, model, [], { ledger: true });
} else registerDocs(delta.server, db, schema, model, [], { ledger: true });

// A session, with no ledger: signing in and out is not the model's history. A session is a numbered
// row, found by its cookie's hash through `visit:` (dzql/rendering/sessions), which `session:` never holds.
registerDocs(delta.server, db, schema, [
  defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["person_id", "name"] } }),
  defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] }),
]);

/** The sessions, a row each, named by the cookie a browser carries. */
export const sessions = sessionRows(delta, "sessions");

export { db };
