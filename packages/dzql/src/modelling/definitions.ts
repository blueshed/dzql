import { defineDoc, defineSchema, type ColumnShorthand, type DocDef, type Schema } from "@blueshed/delta/backend";
import { diff, stateOf, writeMigration, type Change } from "@blueshed/delta/migrations";
import { columnOf, readingOf, typeOf, valueOf, type Model, type Document, type Entity, type Reading, type Story, type StoryWrite } from "./reading";
export type { Model } from "./reading";

// From the model to the app: the stories, the documents they need and what each holds, as the
// model's page keeps them, made into delta's two definitions -- a schema (`defineSchema`, the
// entities) and the documents (`defineDoc`). Those are what every store takes: delta's JSON file
// and SQLite, and dzql's compiled Postgres. So the model is told once, and kept wherever.
//
//   an entity   each one a document holds, with every field any document gives it (the first
//               type said wins), and the first parent any gives it: it hangs from that, and its
//               rows carry the parent's key (`<parent>_id`), so a field of that name is the key.
//   a document  `<name>:`, its root and what it holds under it. One whose root hangs from
//               nothing is there before its row (`implied`): its first write makes it.
//
// What a model does not say is left out, never guessed: who owns a document that is each
// person's own (`own`) is a path from its row to the person, given with sign-in (delta's `owns`).

export { knownType, parentIn, type ModelDocument, type ModelField, type ModelStory } from "./reading";
/** The model as the model's page keeps it (`model:1`): its stories and documents, each a row by its id; a list does as well. */


/** The model as delta's definitions: the schema of its entities, and its documents over them. */
/** The tables an app's migrations have made already, each as it was made (`stateOf` its history). */
export type Made = Record<string, { temporal: boolean }>;

export function definitionsOf(model: Model, made: Made = {}): { schema: Schema; docs: DocDef[] } {
  const m = readingOf(model);
  // the entities a document holds, each with its fields as columns -- but delta's own: the row's id, and the key to its parent
  const held = [...m.entities.values()].filter((e) => e.documents.length > 0);
  // a ref keeps the id of the row it names, in `<label>_id`
  const columnsOf = (e: Entity) =>
    Object.fromEntries([...e.fields].map(([f, type]) => [columnOf({ name: f, type }), type] as const).filter(([c]) => c !== "id" && !(e.parent && c === `${e.parent}_id`)).map(([c, type]) => [c, `${typeOf(type)}?` as ColumnShorthand]));
  // every table keeps its history (delta's default): a row removed is closed, never gone, so what
  // names it still names a row (and keeps its surrogate, `<ref>_<field>`, to show it). A table an
  // app's migrations made already stays as they made it: its database says so
  const schema = defineSchema(Object.fromEntries(held.map((e) => [e.name, { columns: columnsOf(e), temporal: made[e.name]?.temporal ?? true, ...(e.parent ? { parent: e.parent } : {}) }])));
  // a document that names fewer of an entity's fields than another gives it shows, is told and takes
  // only those (delta's `columns`); one that names none of them has not said, and keeps them all
  const columns = (d: Document) => {
    const fewer = Object.entries(d.holds).filter(([e, h]) => h.fields.length > 0 && [...m.entities.get(e)!.fields.keys()].some((f) => !h.fields.some((x) => x.name === f)));
    return fewer.length ? { columns: Object.fromEntries(fewer.map(([e, h]) => [e, h.fields.map((f) => columnOf({ name: f.name, type: m.entities.get(e)!.fields.get(f.name) }))])) } : {};
  };
  const docs = m.documents.map((d) => defineDoc(`${d.name}:`, { root: d.root, include: Object.keys(d.holds).filter((e) => e !== d.root), ...(d.implied ? { implied: true } : {}), ...columns(d) }));
  return { schema, docs };
}

/**
 * The same, as the source of an app's file: what `dzql model` writes. It imports from
 * delta's JSON file, where an app starts; moving to SQLite or Postgres changes that import alone.
 */
export function sourceOf(model: Model, from = "@blueshed/delta/json", made: Made = {}): string {
  const { schema, docs } = definitionsOf(model, made);
  const m = readingOf(model);
  const json = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(json).join(", ")}]`
    : v !== null && typeof v === "object" ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${json(x)}`).join(", ")} }` : "{}")
    : JSON.stringify(v);
  const tables = Object.values(schema.tables).map((t) => {
    const columns = Object.fromEntries(Object.entries(t.columns).map(([c, def]) => [c, `${def.type}${def.nullable ? "?" : ""}`]));
    return `  ${t.docKey}: ${json({ columns, temporal: t.temporal, ...(t.parent ? { parent: t.parent.collection } : {}) })},`;
  });
  const defs = docs.flatMap((def, i) => {
    const d = m.documents[i]!;
    const serves = m.stories.filter((s) => d.serves.includes(s.id)).map((s) => `  // for: ${s.text}`);
    const own = d.own ? ["  // each person's own: say whose with `owns` (a path to the person) once people sign in"] : [];
    const list = d.list ? [`  // every ${d.root}: opened as ${JSON.stringify(def.prefix)}`] : [];
    const opts = { root: def.root, include: def.include, ...(def.implied ? { implied: true } : {}), ...(def.columns ? { columns: def.columns } : {}) };
    return [...serves, ...own, ...list, `  defineDoc(${JSON.stringify(def.prefix)}, ${json(opts)}),`];
  });
  return [
    "// The model, as delta's definitions: written by `dzql model` from the model's page.",
    "// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).",
    `import { defineDoc, defineSchema } from ${JSON.stringify(from)};`,
    "",
    "// The model's tables: an app that keeps more (who signs in, its sessions) defines them beside these,",
    "// `defineSchema({ ...tables, ... })`, and runs its own migrations after the model's.",
    "export const tables: Parameters<typeof defineSchema>[0] = {",
    ...tables,
    "};",
    "",
    "export const schema = defineSchema(tables);",
    "",
    "export const docs = [",
    ...defs,
    "];",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// The rest of what the model makes, each from the model alone, the same every time:
//
//   types       the snapshot: a row type per table, and each document's shape over them
//   migrations  the trajectory: the next step each time the checks pass and the schema says more
//               than the steps so far, as delta's `migrations make` writes it; folded from empty
//               they are the schema the types describe
//   proof       model.test.ts: the migrations from empty are the types, and each story's write
//               lands in every holder's document, on SQLite
// ---------------------------------------------------------------------------------------------

const TS: Record<string, string> = { text: "string", integer: "number", real: "number", boolean: "boolean", json: "unknown", timestamptz: "string", date: "string", numeric: "string" };
const pascal = (key: string) => key.replace(/(^|[_-])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/**
 * The snapshot: `types.ts`, as hjeli's was -- the definitions (`sourceOf`), then each table's row
 * and each document's shape (its root, then each collection it holds by id). On delta's JSON file it
 * is all an app needs; SQLite and Postgres take the same definitions, with the migrations.
 */
export function typesOf(model: Model, from = "@blueshed/delta/json", made: Made = {}): string {
  const { schema, docs } = definitionsOf(model, made);
  const rowsOf = Object.values(schema.tables).map((t) => {
    const fields = [
      "id: number;",
      ...(t.parent ? [`${t.parent.fkColumn}: number;`] : []),
      ...Object.entries(t.columns).map(([c, d]) => `${c}: ${TS[d.type] ?? "unknown"}${d.nullable ? " | null" : ""};`),
    ];
    return `export type ${pascal(t.docKey)}Row = { ${fields.join(" ")} };`;
  });
  const listed = new Set(readingOf(model).documents.filter((d) => d.list).map((d) => `${d.name}:`));
  const shapes = docs.map((d) => {
    const name = pascal(d.prefix.replace(/:$/, ""));
    // one row is its root; a list is every row of it, by id
    const root = listed.has(d.prefix) ? `Record<string, ${pascal(d.root)}Row>` : `${pascal(d.root)}Row`;
    const parts = [`${d.root}: ${root};`, ...d.include.map((c) => `${c}: Record<string, ${pascal(c)}Row>;`)];
    return `export type ${name}Doc = { ${parts.join(" ")} };`;
  });
  return [
    sourceOf(model, from, made).replace("// The model, as delta's definitions: written by `dzql model` from the model's page.", "// The model, now: delta's definitions, a row type per table and each document's shape. Written by `dzql model` from the model's page; never edited by hand."),
    ...rowsOf,
    "",
    ...shapes,
    "",
  ].join("\n");
}

/**
 * The trajectory's next step: what the model's schema says beyond the migrations so far (delta's
 * `diff` over their changes, folded), as the next migration (`writeMigration`), named by its number
 * and its tables -- or nothing, when they already lead to it. Made each time the checks pass, the
 * migrations are the model's history from empty, one step per change to its schema.
 */
export function nextMigrationOf(history: { changes?: Change[] }[], model: Model, owed?: (line: string) => boolean): { name: string; source: string } | undefined {
  const made = stateOf(history);
  const { changes, byHand: all } = diff(made, definitionsOf(model, made).schema);
  // what a person must finish that an earlier step already says is owed there, not here again
  const byHand = all.filter((b) => !owed?.(`// By hand: ${b}`));
  if (!changes.length && !byHand.length) return undefined;
  const keys = [...new Set(changes.map((c) => c.key))].slice(0, 3).join("-") || "by-hand";
  return { name: `${String(history.length + 1).padStart(3, "0")}-${keys}`, source: writeMigration(changes, byHand) };
}

/** A write as the proof makes it: who makes it (a story's teller), on which document, and its ops. */
type Write = { as: string; doc: string; ops: Record<string, unknown>[] };
/** One story as the tests tell it: its writes, each on a document that holds what it writes, the writes it needs first (in order), and the documents it is born into. */
type Planned = { s: Story; writes: Write[]; premise: Write[]; serving: Document[] };

/**
 * Each story, planned: its writes on the documents it is born into -- one that holds every entity
 * it writes if there is one, else each write on one that holds its entity, one its teller may write
 * on first -- at row 1 of what it changes and under row 1 of the parent it adds under, each a write
 * of its own, made in turn, as a page makes them; and its premise, the stories it needs -- whoever
 * adds the row it changes or adds under, or sets the state it requires -- each after what it needs
 * in turn. A value is of its field's type ("false" is false on a boolean).
 */
function planOf(m: Reading): Planned[] {
  const typed = (w: StoryWrite) => valueOf(m.typeOf(w.entity, w.path), w.to);
  const holding = (s: Story, entities: string[]) => m.serving(s).filter((d) => entities.every((e) => e in d.holds));
  // where a write is made: a page of rows rather than the row's own document (a table is added on
  // the floor), then one the teller may write on (the guards' `where`)
  const best = (s: Story, docs: Document[], entity: string) => {
    const cost = (d: Document) => (d.root === entity && !d.list ? 2 : 0) + (m.writable(s.actor, entity).includes(d) ? 0 : 1);
    return [...docs].sort((x, y) => cost(x) - cost(y))[0];
  };
  // the row's own document addresses it by its id (delta: /<root>/<id>), a page of rows by /<collection>/<id>
  const opOf = (d: Document, w: StoryWrite) => {
    const parent = m.parentOf(w.entity);
    const col = w.path && m.columnIn(w.entity, w.path);
    // a new row hangs under row 1 of its parent, and names row 1 of each document its refs point into
    const fields = { ...(parent ? { [`${parent}_id`]: 1 } : {}), ...Object.fromEntries(m.refsOf(w.entity).map((r) => [r.key, 1])), ...(col ? { [col]: typed(w) } : {}) };
    // the document's own root is there once the document is open (made by the store, or by the proof
    // for one under a parent), so adding it is setting the field it says, if it says one
    if (w.op === "add" && w.entity === d.root && !d.list) return col ? { op: "replace", path: `/${w.entity}/1/${col}`, value: typed(w) } : undefined;
    if (w.op === "add") return { op: "add", path: `/${w.entity}/-`, value: fields };
    const row = `/${w.entity}/1`;
    return w.op === "remove" ? { op: "remove", path: `${row}${col ? `/${col}` : ""}` } : { op: "replace", path: `${row}/${col}`, value: typed(w) };
  };
  // a story's writes; as setup for another (`setup`), only what makes and sets, never what it takes
  // away: a premise that removes a row would take the one the later story stands on (cafe-e's feedback)
  const writesOf = (s: Story, setup = false): Write[] => {
    const ws = s.writes.filter((w) => !setup || w.op !== "remove");
    if (!ws.length || s.post) return [];
    const all = best(s, holding(s, [...new Set(ws.map((w) => w.entity))]), ws[0]!.entity);
    const writes: Write[] = [];
    for (const w of ws) {
      const d = all ?? best(s, holding(s, [w.entity]), w.entity);
      const op = d && opOf(d, w);
      if (!op) continue;
      // a story's writes are the kinds of change it makes, not a count: two adds of one entity are
      // one new row, starting with each value said (`add books.out=false add books.damaged=false`,
      // an evaluation's feedback)
      const same = op.op === "add" && writes.find((x) => x.doc === m.nameOf(d) && x.ops[0]!.op === "add" && x.ops[0]!.path === op.path);
      if (same) Object.assign(same.ops[0]!.value as Record<string, unknown>, op.value);
      else writes.push({ as: s.actor, doc: m.nameOf(d), ops: [op] });
    }
    return writes;
  };
  // whoever a story needs first: the stories that add the rows it changes or adds under, or set the state it requires
  // a state is set up by one story, the one that presupposes least (a table added free, not one
  // paid and freed: cafe-c's feedback), so a premise never needs what it is setting up
  const presupposes = (o: Story) => o.writes.filter((w) => w.op !== "add").length + o.requires.length;
  const direct = (s: Story): Story[] => {
    const rows = new Set<string>();
    for (const w of s.writes) {
      if (w.op !== "add") rows.add(w.entity);
      const p = m.parentOf(w.entity);
      if (w.op === "add" && p) rows.add(p);
      // a row it names: each ref a new row starts with, or the one a replace points it at
      for (const r of m.refsOf(w.entity)) if (w.op === "add" || w.path === r.label) rows.add(r.collection);
    }
    const doing = m.doing.filter((o) => o !== s);
    const adders = doing.filter((o) => o.writes.some((w) => w.op === "add" && rows.has(w.entity)));
    const setters = s.requires.flatMap((r) => {
      const by = doing.filter((o) => o.writes.some((w) => `${w.entity}.${w.path}=${w.to}` === `${r.entity}.${r.path}=${r.value}`));
      return by.length ? [by.reduce((best, o) => (presupposes(o) < presupposes(best) ? o : best))] : [];
    });
    return m.stories.filter((o) => adders.includes(o) || setters.includes(o)); // in the order told
  };
  // each with what it needs before it, depth first, each once
  const needs = (s: Story): Story[] => {
    const out: Story[] = [];
    const seen = new Set<Story>([s]);
    const visit = (o: Story) => {
      if (seen.has(o)) return;
      seen.add(o);
      direct(o).forEach(visit);
      out.push(o);
    };
    direct(s).forEach(visit);
    return out;
  };
  return m.stories.map((s) => ({ s, writes: writesOf(s), premise: needs(s).flatMap((o) => writesOf(o, true)), serving: m.serving(s) }));
}

const lit = (v: unknown) => JSON.stringify(v);

/** The rows the proof makes before any story: row 1 of each document's root that hangs from another, and each above it -- but none a story adds. */
const made = (m: Reading): string[] => [...new Set(m.documents.flatMap((d) => (m.parentOf(d.root) && !d.list ? m.above(d.root).reverse() : [])))].filter((e) => !m.added.has(e));

/**
 * The model, proved on a store: `model.test.ts`. The migrations, run from empty on SQLite, are the
 * schema the types describe (no drift); and each story's write, after the writes it needs in order,
 * lands on its document and is there in every document each person it tells holds. No page is
 * needed: it is the model's definitions under delta, as an app keeps them. The app's own stories,
 * each saying its model story's number, are told against its pages.
 */
export function testsOf(model: Model, app = "model", types = "./types", guards?: string): string {
  const m = readingOf(model);
  const holds = (d: Document, w: StoryWrite) => w.entity in d.holds && (!w.path || d.holds[w.entity]!.fields.some((f) => f.name === w.path));
  // a story the proof cannot tell is said, never dropped: a gap in the model fails, and the rest are
  // left to do, each saying why (an evaluation's feedback: the bakery's refusal had no case at all)
  const unproved: string[] = [];
  const cases = planOf(m).flatMap(({ s, writes, premise, serving }) => {
    const nowhere = [...new Set(s.writes.map((w) => w.entity))].filter((e) => !serving.some((d) => e in d.holds));
    const why =
      s.post ? "a form posted to a route, which the app's stories prove"
      : !s.writes.length ? "it says nothing it writes (writes <story> add <entity>...)"
      : nowhere.length ? undefined
      : s.kind === "cannot" && !guards ? "a refusal is proved through the guards, and none were made"
      : !writes.length ? "what it writes is its document's own row, there before any write: nothing to prove"
      : "";
    if (why === undefined) {
      const at = serving.length ? `no document it is done on (${serving.map((d) => d.name).join(", ")}) holds ${nowhere.join(", ")}` : "no document serves it";
      unproved.push(`test(${lit(s.text)}, () => {`, `  throw new Error(${lit(`not proved: ${at}, so it is done nowhere`)});`, "});");
      return [];
    }
    if (why) {
      unproved.push(`test.todo(${lit(`${s.text} -- not proved here: ${why}`)});`);
      return [];
    }
    const told = [...new Set([s.actor, ...serving.flatMap((d) => d.held_by)])];
    // what is there after the whole story: an entity it removes is checked as nothing more
    const removed = new Set(s.writes.filter((w) => w.op === "remove" && !w.path).map((w) => w.entity));
    const checks = (s.kind === "cannot" ? [] : s.writes).filter((w) => !removed.has(w.entity)).flatMap((w) =>
      told.flatMap((who) =>
        serving.filter((d) => d.held_by.includes(who) && holds(d, w)).map((d) => ({ who, doc: m.nameOf(d), entity: w.entity, ...(w.path ? { path: m.columnIn(w.entity, w.path), to: valueOf(m.typeOf(w.entity, w.path), w.to), ...(m.typeOf(w.entity, w.path) === "timestamptz" ? { time: true } : {}) } : {}), root: d.root === w.entity && !d.list })),
      ),
    );
    return [`  [${lit(s.text)}, ${lit(s.kind === "cannot")}, ${lit(premise)}, ${lit(writes)}, ${lit(checks)}],`];
  });
  return [
    "// The model, proved on a store: written by `dzql model` from the model's page; never edited by hand.",
    'import { Database } from "bun:sqlite";',
    'import { describe, expect, test } from "bun:test";',
    'import { createLocal } from "@blueshed/delta/local";',
    'import { diff, stateOf } from "@blueshed/delta/migrations";',
    `import { fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";`,
    ...(guards ? ['import { guardWrites, rowsIn } from "dzql/modelling/guards";', `import { guards } from ${lit(guards)};`] : []),
    `import { docs, schema } from ${lit(types)};`,
    "",
    "const migrations = await fromFolder(`${import.meta.dir}/migrations`);",
    "// what a person must finish by hand (a parent changed) is owed by the step that says so",
    "const owed = (await Promise.all([...new Bun.Glob(\"*.ts\").scanSync(`${import.meta.dir}/migrations`)].map((f) => Bun.file(`${import.meta.dir}/migrations/${f}`).text()))).join(\"\\n\");",
    "async function store() {",
    '  const db = new Database(":memory:");',
    `  await migrate(db, migrations, { app: ${lit(app)}, schema });`,
    "  // a document whose root hangs from another is opened at a row that is there: row 1, and each above it,",
    "  // but a row a story adds is that story's, made by the premise of whatever needs it",
    `  for (const e of ${lit(made(m))}) {`,
    "    const t = schema.tables[e]!;",
    "    db.run(`INSERT OR IGNORE INTO \"${t.name}\" (id${t.parent ? `, \"${t.parent.fkColumn}\"` : \"\"}) VALUES (1${t.parent ? \", 1\" : \"\"})`);",
    "  }",
    "  const local = createLocal();",
    ...(guards ? ["  // the guards stand in front of the store, as in the app: each write is made as its story's teller", "  guardWrites(local.server, guards, { actorOf: (who) => (who as { actor?: string } | undefined)?.actor, rowOf: rowsIn(db, schema) });"] : []),
    "  registerDocs(local.server, db, schema, docs);",
    "  return { local };",
    "}",
    "",
    'test("the migrations, from empty, are the schema the types describe", async () => {',
    "  const { changes, byHand } = diff(stateOf(migrations), schema);",
    "  expect({ changes, byHand: byHand.filter((b) => !owed.includes(`// By hand: ${b}`)) }).toEqual({ changes: [], byHand: [] });",
    "});",
    "",
    "type Write = { as: string; doc: string; ops: unknown[] };",
    "type Check = { who: string; doc: string; entity: string; path?: string; to?: unknown; root: boolean };",
    "// each story: its words, whether it is refused, the writes it needs first, its own, and who then sees what",
    "const cases: [string, boolean, Write[], Write[], Check[]][] = [",
    ...cases,
    "];",
    "",
    `describe(${lit(guards ? "each story, on the store, each guarded" : "each story, on the store")}, () => {`,
    "  for (const [name, refused, premise, does, checks] of cases)",
    "    test(name, async () => {",
    "      const { local } = await store();",
    "      // a write goes to a document its writer has open, as on a page",
    "      const write = async ({ as, ...w }: Write) => {",
    "        const writer = local.as({ actor: as });",
    '        expect((await writer.call("open", { doc: w.doc })).error, `open ${w.doc}`).toBeUndefined();',
    '        return writer.call("delta", w);',
    "      };",
    "      for (const w of premise) expect(await write(w), `the premise: ${JSON.stringify(w)}`).toEqual({ result: { ack: true } });",
    "      // a story someone cannot do is refused, in its own words",
    "      for (const w of does) expect(await write(w), JSON.stringify(w)).toMatchObject(refused ? { error: { code: 403, message: name } } : { result: { ack: true } });",
    "      for (const c of checks) {",
    '        const doc = (await local.call("open", { doc: c.doc })).result as Record<string, any>;',
    "        const rows = c.root ? [doc[c.entity]] : Object.values(doc[c.entity] ?? {});",
    '        expect(rows.some((r: any) => r && (c.path === undefined || ("time" in c ? Date.parse(String(r[c.path])) === Date.parse(String(c.to)) : r[c.path] === c.to))), `${c.who} sees ${c.entity}${c.path ? `.${c.path} = ${c.to}` : ""} in ${c.doc}`).toBe(true);',
    "      }",
    "    });",
    "});",
    "",
    ...(unproved.length ? ["// each story the proof cannot tell, and why", ...unproved, ""] : []),
  ].join("\n");
}
