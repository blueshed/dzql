import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "../../src/db";

// modeling's documents, in delta (`@blueshed/delta`). A model -- its stories and the documents
// they need -- is one document, written by the two who keep it and on the ledger. What each
// document holds (its entities and their fields), who holds it, and which stories it serves are
// its own columns: the entities are worked out from them (./model.ts), never kept. A session is
// who you are, and what you have picked to see what goes with it; it is signed in by the sign-in page (./signin.ts) and kept off the ledger. How
// someone signs in is a table no document includes, so no hash crosses the wire. The tables are
// modeling's own (`mdl_`).

export const schema = defineSchema({
  models: { table: "mdl_models", columns: { name: "text" }, temporal: false },
  stories: { table: "mdl_stories", parent: "models", columns: { text: "text" }, temporal: false },
  documents: { table: "mdl_documents", parent: "models", columns: { name: "text", holds: "json", held_by: "json", stories: "json" }, temporal: false },
  people: { table: "mdl_people", columns: { name: "text" }, temporal: false },
  sessions: { table: "mdl_sessions", columns: { person_id: "text?", name: "text?", chosen: "text?" }, temporal: false },
  logins: { table: "mdl_logins", columns: { person_id: "text", hash: "text" }, temporal: false },
});

createTables(db, schema);

// The two who keep a model, each with a password made up for the example (a login's id is its
// email), and the model as it starts: leave's first two stories, and the two documents they need.
if (!db.query("SELECT 1 FROM mdl_models").get()) {
  for (const [id, name] of [["1", "Peter"], ["2", "Claude"]] as const) {
    const login = name.toLowerCase();
    db.run("INSERT INTO mdl_people (id, name) VALUES (?, ?)", [id, name]);
    db.run("INSERT INTO mdl_logins (id, person_id, hash) VALUES (?, ?, ?)", [`${login}@modeling.example`, id, Bun.password.hashSync(`${login}-password`)]);
  }
  db.run("INSERT INTO mdl_models (id, name) VALUES ('1', 'Leave')");
  db.run("INSERT INTO mdl_stories (id, models_id, text) VALUES ('1', '1', 'Ann asks for a week off, and Mo sees it waiting'), ('2', '1', 'Mo approves Ann''s week, and Ann sees it approved')");
  const person = [{ name: "name", type: "text" }, { name: "role", type: "text" }];
  const request = [{ name: "starts", type: "date" }, { name: "ends", type: "date" }, { name: "status", type: "text" }];
  db.run("INSERT INTO mdl_documents (id, models_id, name, holds, held_by, stories) VALUES ('1', '1', 'team', ?, ?, ?), ('2', '1', 'inbox', ?, ?, ?)", [
    JSON.stringify({ Person: person, Request: request }),
    JSON.stringify(["Ann", "Bo", "Mo"]),
    JSON.stringify(["1", "2"]),
    JSON.stringify({ Request: request }),
    JSON.stringify(["Mo"]),
    JSON.stringify(["2"]),
  ]);
}

export const delta = createLocal();

registerDocs(delta.server, db, schema, [defineDoc("model:", { root: "models", include: ["stories", "documents"] })], [], { ledger: true });

// A session, with no ledger: signing in and out is not the model's history.
registerDocs(delta.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], implied: true })]);

export { db };
