// The guarded write layer, hjeli's: every write the stories say, with what it presupposes, checked
// before the store takes it. hjeli generated `operations.ts` from an action's guards (`state`,
// `exists`, `is_member`, `byOther`); here the model's own words are the guards, as the model's page
// keeps them:
//
//   who      a story's teller: only someone a story says does it may make the write
//   what     a story's `writes`: the entity, the verb, and for a replace the field and the value it sets
//   where    hjeli's `is_member`: the document written is one the teller holds (`held_by`, or its own)
//   exists   a replace or a remove finds its row
//   state    a story's `requires`: the row written, or a row it hangs under, holds the value
//            (`requires requests.status=waiting`)
//
// A `cannot` story that names a write, its requirements holding, is the reason it is refused, in its words alone: the page
// shows them, and the story's number goes beside them (`story`) for logs and the harness. A write that no story says is
// refused, never let through: the model is what may happen. A requirement on a row that is neither
// the one written nor one above it cannot be checked from the write, so its story is refused with
// that said (hjeli's custom operation, left to a person to finish) -- never half-guarded.
//
// `guardsOf(model)` works the guards out; `dzql model guards` writes them as an app's file, only
// once the six registers are closed. `guardWrites(ws, guards, ...)` puts them in front of any of
// delta's stores -- the JSON file, SQLite, dzql's Postgres -- as the first of its `delta` handlers:
// a write it refuses is answered 403 with the reason; one it lets by goes on to the store. Each op
// of a write is checked against the rows as they stand before it.

import { splitPath } from "@blueshed/delta/core";
import { readingOf, says as saysWord, type Model, type StoryWrite } from "./reading";
export type { Model } from "./reading";

export type { Requires, StoryWrite } from "./reading";

/** One write one story says, and what it takes. */
export type Rule = {
  story: string | number;
  text: string;
  actor: string;
  /** A `does` story lets it; a `cannot` story is the reason it is refused. */
  allow: boolean;
  entity: string;
  op: StoryWrite["op"];
  field?: string;
  to?: string;
  /** The field's type, as the model says it: a value is compared as that type has it ("false" on a boolean is false). */
  type?: string;
  /** The documents the teller holds that show the entity: the write must be to one of them. */
  docs: string[];
  /** What it presupposes, each with the rows climbed to reach it from the one written: `[]` is that row. */
  requires: { entity: string; field: string; value: string; via: Hop[]; type?: string }[];
  /** Why it cannot be checked from the write: then it is refused, saying so. */
  custom?: string;
};
/** A row climbed to: a parent, by its name (its key `<parent>_id`), or the row a ref names, by the ref's column. */
export type Hop = string | { entity: string; key: string };

/** The guards: the documents they stand in front of, and each write's rule. */
export type Guards = {
  documents: string[];
  rules: Rule[];
  /** Each document's root, by its name: its row is addressed as `/<root>/<field>` too (delta's). */
  roots?: Record<string, string>;
  /** The entities whose row is there before any story adds it (an implied document's root): delta makes it on the first write. */
  there?: string[];
};

export type Op = { op: string; path: string; value?: unknown };
export type Row = Record<string, unknown>;
export type RowOf = (entity: string, id: string) => Row | undefined | null | Promise<Row | undefined | null>;
export type Verdict = { ok: true; story: string | number } | { ok: false; reason: string; story?: string | number };


/** The guards the model's stories say, over the documents it describes. */
export function guardsOf(model: Model): Guards {
  const m = readingOf(model);
  const rules: Rule[] = [];
  for (const s of m.stories) {
    if (s.post) continue; // a form posted to a route: the route's, not a document's
    // a requirement is checked on each write that can reach it (its row, or one it hangs under);
    // one that none of the story's writes reaches cannot be checked at all (cafe-c's feedback)
    const reaches = (w: StoryWrite, r: { entity: string }) => m.reach(w.entity).has(r.entity);
    for (const w of s.writes) {
      const chain = m.reach(w.entity);
      const requires: Rule["requires"] = [];
      let custom: string | undefined;
      for (const r of s.requires) {
        const hops = chain.get(r.entity);
        // a parent by its name, as the guards always kept it; a ref by its column
        if (hops) requires.push({ entity: r.entity, field: r.path, value: r.value, via: hops.map((h) => (h.key === `${h.entity}_id` ? h.entity : h)), ...typed(m.typeOf(r.entity, r.path)) });
        else if (!s.writes.some((x) => reaches(x, r))) custom ??= `it presupposes ${r.entity}.${r.path}=${r.value}, which none of its writes reaches (a row it writes, one that hangs above it, or one a ref names)`;
      }
      rules.push({
        story: Number(s.id),
        text: s.text,
        actor: s.actor,
        allow: s.kind !== "cannot",
        entity: w.entity,
        op: w.op,
        ...(w.path && { field: m.columnIn(w.entity, w.path) }), // the column a write lands in: a ref's `<label>_id`
        ...(w.to !== undefined && { to: w.to }),
        ...(w.to !== undefined && typed(m.typeOf(w.entity, w.path))),
        docs: m.writable(s.actor, w.entity).map((d) => d.name),
        requires,
        ...(custom && { custom }),
      });
    }
  }
  // each person's own document is the app's session, kept by the app (a perSession resource): not guarded here
  const there = [...new Set(m.documents.filter((d) => d.implied).map((d) => d.root))];
  return { documents: [...new Set(m.documents.filter((d) => !d.own).map((d) => d.name))], rules, roots: Object.fromEntries(m.documents.map((d) => [d.name, d.root])), ...(there.length && { there }) };
}

/** A type worth saying: any but text, which is how a value is compared when none is said. */
const typed = (type: string | undefined) => (type && type !== "text" ? { type } : {});

/** A write's path, as delta reads it (`splitPath`): `/<entity>/<id>[/<field>]`; one that is no pointer names no entity, so no story lets it. */
const segments = (path: string): string[] => {
  try {
    return splitPath(path);
  } catch {
    return [];
  }
};
const said = (op: Op, entity: string, field?: string) => `${op.op} ${entity}${field ? `.${field}` : ""}${field && op.op === "replace" ? `=${JSON.stringify(op.value)}` : ""}`;

/** Does this rule say this op: the same entity and verb, and for a replace the field and value it sets? */
function says(rule: Rule, op: Op, entity: string, field: string | undefined): boolean {
  if (rule.entity !== entity || rule.op !== op.op) return false;
  const sets = (v: unknown) => rule.to === undefined || saysWord(rule.type, v, rule.to);
  if (field !== undefined) return rule.op === "replace" && (!rule.field || (field === rule.field && sets(op.value)));
  if (rule.op === "remove" || !rule.field) return true;
  // an add, or a replace of the row whole: the field the story sets is in it, with its value
  const row = op.value !== null && typeof op.value === "object" ? (op.value as Row) : {};
  return (rule.op === "add" || rule.field in row) && sets(row[rule.field]);
}

/** May `actor` make this op, on document `doc` (its name, before the `:`)? The first story that lets it, or why not. */
export async function check(guards: Guards, write: { actor: string; doc: string; docId?: string; op: Op; rowOf: RowOf }): Promise<Verdict> {
  const { actor, doc, op, rowOf } = write;
  const at = segments(op.path);
  // the document's root row, as delta also addresses it: `/<root>/<field>`, or `/<root>` whole -- its id the document's
  const atRoot = guards.roots?.[doc] === at[0] && (at[1] === undefined || (at[1] !== "-" && !/^\d+$/.test(at[1])));
  const [entity = "", id = "-", field] = atRoot ? [at[0], write.docId ?? "-", at[1]] : at;
  const saying = guards.rules.filter((r) => says(r, op, entity, field));
  const why: string[] = [];
  for (const rule of saying.filter((r) => r.allow && r.actor === actor)) {
    const failed = await unmet(guards, rule, { doc, op, entity, id, rowOf });
    if (!failed) return { ok: true, story: rule.story };
    why.push(`story ${rule.story} ("${rule.text}") ${failed}`);
  }
  // refused in the words of the `cannot` story whose requirements hold: two on one write each say
  // their own state (an evaluation's feedback: a damaged book was refused as one someone held)
  const cannots = saying.filter((r) => !r.allow && r.actor === actor);
  for (const cannot of cannots) if (!(await unmet(guards, cannot, { doc, op, entity, id, rowOf }))) return { ok: false, reason: cannot.text, story: cannot.story };
  // none whose state holds: why the story that would have let it did not, else the first that refuses it
  if (why.length) return { ok: false, reason: why[0]! };
  if (cannots[0]) return { ok: false, reason: cannots[0].text, story: cannots[0].story };
  return { ok: false, reason: `No story says ${actor} may ${said(op, entity, field)}` };
}

/** What a rule needs that this write does not have, or nothing. */
async function unmet(guards: Guards, rule: Rule, at: { doc: string; op: Op; entity: string; id: string; rowOf: RowOf }): Promise<string | undefined> {
  if (rule.custom) return `cannot be checked from the write: ${rule.custom}`;
  if (!rule.docs.includes(at.doc)) return `is told on ${rule.docs.join(", ") || "no document its teller holds"}, not ${at.doc}`;
  let row: Row | undefined | null = at.op.op === "add" ? (at.op.value as Row | undefined) : await at.rowOf(at.entity, at.id);
  // an implied document's root is there before its row: delta makes it on the first write
  if (!row && at.op.op !== "add" && guards.there?.includes(at.entity)) row = { id: at.id };
  if (!row) return `needs the ${at.entity} row ${at.id}, and there is none`;
  const start = row;
  for (const r of rule.requires) {
    row = start;
    for (const up of r.via) {
      const [entity, key] = typeof up === "string" ? [up, `${up}_id`] : [up.entity, up.key];
      row = row && row[key] != null ? await at.rowOf(entity, String(row[key])) : undefined;
    }
    if (!row || !saysWord(r.type, row[r.field], r.value)) return `presupposes ${r.entity}.${r.field}=${r.value}${row ? `, and it is ${JSON.stringify(row[r.field] ?? null)}` : ", and there is no such row"}`;
  }
  return undefined;
}

/** A WsServer's `on`, as delta's is: where the guard stands, before the store. */
type On = { on(action: string, handler: (msg: any, client: any, respond: (r: any) => void) => unknown): void };

/**
 * Stand the guards in front of a store: call before the store registers its documents (delta's
 * `registerDocs`, `./json`'s, dzql's), so its `delta` handler runs first. A write to a document the
 * model does not describe goes by untouched.
 *
 * - `actorOf` names the writer as the stories do (`ann`, `manager`) from the socket's identity;
 *   undefined is someone not signed in, answered 401.
 * - `rowOf` reads a row as the store holds it, for `exists` and `requires`.
 */
export function guardWrites(ws: On, guards: Guards, opts: { actorOf: (identity: unknown, client: unknown) => string | undefined | Promise<string | undefined>; rowOf: RowOf }): void {
  /** The guards' answer to a write, or none when they let it by. */
  const refusal = async (msg: any, client: any): Promise<{ error: { code: number; message: string } } | undefined> => {
    const [doc = "", docId] = String(msg?.doc ?? "").split(":");
    if (!guards.documents.includes(doc) || !Array.isArray(msg.ops)) return; // not the model's, or the store's 400
    if (client?.data?.local && client.data.identity === undefined) return; // the server's own write (dzql's serverWrite), no person's
    const actor = await opts.actorOf(client?.data?.identity, client);
    if (actor === undefined) return { error: { code: 401, message: `Sign in to write to ${msg.doc}` } };
    for (const op of msg.ops as Op[]) {
      const verdict = await check(guards, { actor, doc, docId, op, rowOf: opts.rowOf });
      if (!verdict.ok) return { error: { code: 403, message: verdict.reason, ...(verdict.story !== undefined && { story: verdict.story }) } };
    }
  };
  ws.on("delta", async (msg, client, respond) => {
    const refused = await refusal(msg, client);
    if (refused) respond(refused);
  });
  // asked, never written: would the guards let this write by? (the stories harness asks before it
  // calls a write no story tells a hidden verb)
  ws.on("may", async (msg, client, respond) => respond((await refusal(msg, client)) ?? { result: { ok: true } }));
}

/**
 * A `rowOf` for a SQLite store (delta's, or the JSON file's): the row as the schema says it, its
 * booleans as booleans (SQLite keeps them as 0 and 1), so a story's `requires paid=false` reads true.
 * A table that keeps its history gives its open version: a row removed is closed, and is not there.
 */
export function rowsIn(db: { query(sql: string): { get(...params: unknown[]): unknown } }, schema: { tables: Record<string, { name: string; columns: Record<string, { type: string }>; temporal?: boolean }> }): RowOf {
  return (entity, id) => {
    const t = schema.tables[entity];
    if (!t) return null;
    const row = db.query(`SELECT * FROM "${t.name}" WHERE id = ?${t.temporal ? " AND valid_to IS NULL" : ""}`).get(id) as Row | null;
    if (row) for (const [name, c] of Object.entries(t.columns)) if (c.type === "boolean" && row[name] != null) row[name] = !!row[name];
    return row;
  };
}

/**
 * A `rowOf` for a Postgres store (a server, or PGlite in this process): the row as the schema says
 * it, read with `pool.query`. Postgres keeps booleans as booleans, so nothing is read again. A table
 * that keeps its history gives its open version, as `rowsIn` does.
 */
export function rowsInPostgres(pool: { query(sql: string, params: unknown[]): Promise<{ rows: Row[] }> }, schema: { tables: Record<string, { name: string; temporal?: boolean }> }): RowOf {
  return async (entity, id) => {
    const t = schema.tables[entity];
    if (!t) return null;
    return (await pool.query(`SELECT * FROM "${t.name}" WHERE id = $1${t.temporal ? " AND valid_to IS NULL" : ""}`, [id])).rows[0] ?? null;
  };
}

/** The guards as an app's file: what `dzql model guards` writes. */
export function guardSource(guards: Guards, from = "model.sqlite"): string {
  const open = guards.rules.filter((r) => r.custom);
  return [
    `// Generated by \`dzql model guards\` from ${from}: every write the stories say, and what it`,
    `// presupposes. Do not edit: tell the model, and generate again. Stand them in front of the store,`,
    `// before it registers its documents:`,
    `//`,
    `//   guardWrites(ws, guards, { actorOf: (identity) => ..., rowOf: (entity, id) => ... });`,
    ...(open.length ? [`//`, `// Refused until a person finishes them (a requirement the write cannot reach):`, ...open.map((r) => `//   story ${r.story}: ${r.custom}`)] : []),
    `import type { Guards } from "dzql/modelling/guards";`,
    ``,
    `export const guards: Guards = ${JSON.stringify(guards, null, 2)};`,
    ``,
  ].join("\n");
}
