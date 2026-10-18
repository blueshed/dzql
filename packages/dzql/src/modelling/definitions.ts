import { defineDoc, defineSchema, type ColumnShorthand, type DocDef, type Schema } from "@blueshed/delta/backend";
import { diff, stateOf, writeMigration, type Change } from "@blueshed/delta/migrations";

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

/** A field as a document holds it: its name, and its type as the modeller said it ("text" unless said). */
export type ModelField = { name: string; type?: string };
/** The model as the model's page keeps it (`model:1`): its stories and documents, each a row by its id; a list does as well. */
export type Model = {
  stories?: Record<string, ModelStory> | ModelStory[];
  documents?: Record<string, ModelDocument> | ModelDocument[];
};
export type ModelStory = { id: string | number; text: string; actor: string; kind?: string };
export type ModelDocument = {
  id: string | number;
  name: string;
  root: string;
  own?: number | boolean;
  holds?: Record<string, { parent: string | null; fields?: ModelField[] }>;
  held_by?: string[];
  stories?: (string | number)[];
};

/** delta's column type for a modeller's word: its own types as they are, a day as its text, a number as a real; else text. */
const TYPES: Record<string, ColumnShorthand> = {
  text: "text?", integer: "integer?", int: "integer?", real: "real?", number: "real?", boolean: "boolean?", bool: "boolean?",
  json: "json?", timestamptz: "timestamptz?", timestamp: "timestamptz?", time: "timestamptz?", date: "text?",
};
/** A type the modeller may say: each maps to one of delta's, and any other is a gap (referential closure), never guessed as text. */
export const knownType = (type = "text"): boolean => type.trim().toLowerCase() in TYPES;
const columnType = (type = "text"): ColumnShorthand => TYPES[type.trim().toLowerCase()] ?? "text?";

/** Where an entity hangs, as one document says it: from nothing when it is that document's root, else under its parent (or the root). */
export const parentIn = (d: Pick<ModelDocument, "root">, name: string, held: { parent: string | null }): string | null => (name === d.root ? null : (held.parent ?? d.root));

const rows = <T extends { id: string | number }>(of: Record<string, T> | T[] | undefined): T[] =>
  Object.values(of ?? {}).sort((a, b) => Number(a.id) - Number(b.id));

type Entity = { parent: string | null; columns: Record<string, ColumnShorthand> };

/** The entities, worked out from the documents in the order they were described. */
function entitiesOf(documents: ModelDocument[]): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  for (const d of documents) {
    for (const [name, held] of Object.entries(d.holds ?? { [d.root]: { parent: null } })) {
      const e = entities.get(name) ?? entities.set(name, { parent: null, columns: {} }).get(name)!;
      e.parent ??= parentIn(d, name, held); // a document's root says nothing of its parent: the first that gives one wins
      for (const f of held.fields ?? []) {
        if (f.name === "id" || (e.parent && f.name === `${e.parent}_id`)) continue; // delta's own: the row's id, and the key to its parent
        e.columns[f.name] ??= columnType(f.type);
      }
    }
  }
  return entities;
}

/** The model as delta's definitions: the schema of its entities, and its documents over them. */
export function definitionsOf(model: Model): { schema: Schema; docs: DocDef[] } {
  const documents = rows(model.documents);
  const entities = entitiesOf(documents);
  const schema = defineSchema(
    Object.fromEntries([...entities].map(([name, e]) => [name, { columns: e.columns, temporal: false, ...(e.parent ? { parent: e.parent } : {}) }])),
  );
  const docs = documents.map((d) =>
    defineDoc(`${d.name}:`, { root: d.root, include: Object.keys(d.holds ?? {}).filter((e) => e !== d.root), ...(entities.get(d.root)!.parent ? {} : { implied: true }) }),
  );
  return { schema, docs };
}

/**
 * The same, as the source of an app's file: what `dzql model` writes. It imports from
 * delta's JSON file, where an app starts; moving to SQLite or Postgres changes that import alone.
 */
export function sourceOf(model: Model, from = "@blueshed/delta/json"): string {
  const { schema, docs } = definitionsOf(model);
  const stories = new Map(rows(model.stories).map((s) => [String(s.id), s]));
  const documents = rows(model.documents);
  const json = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(json).join(", ")}]`
    : v !== null && typeof v === "object" ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${json(x)}`).join(", ")} }` : "{}")
    : JSON.stringify(v);
  const tables = Object.values(schema.tables).map((t) => {
    const columns = Object.fromEntries(Object.entries(t.columns).map(([c, def]) => [c, `${def.type}${def.nullable ? "?" : ""}`]));
    return `  ${t.docKey}: ${json({ columns, temporal: false, ...(t.parent ? { parent: t.parent.collection } : {}) })},`;
  });
  const defs = docs.flatMap((def, i) => {
    const d = documents[i]!;
    const serves = (d.stories ?? []).flatMap((id) => stories.get(String(id)) ?? []).map((s) => `  // for: ${s.text}`);
    const own = d.own ? ["  // each person's own: say whose with `owns` (a path to the person) once people sign in"] : [];
    const opts = { root: def.root, include: def.include, ...(def.implied ? { implied: true } : {}) };
    return [...serves, ...own, `  defineDoc(${JSON.stringify(def.prefix)}, ${json(opts)}),`];
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

const TS: Record<string, string> = { text: "string", integer: "number", real: "number", boolean: "boolean", json: "unknown", timestamptz: "string" };
const pascal = (key: string) => key.replace(/(^|_)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

/**
 * The snapshot: `types.ts`, as hjeli's was -- the definitions (`sourceOf`), then each table's row
 * and each document's shape (its root, then each collection it holds by id). On delta's JSON file it
 * is all an app needs; SQLite and Postgres take the same definitions, with the migrations.
 */
export function typesOf(model: Model, from = "@blueshed/delta/json"): string {
  const { schema, docs } = definitionsOf(model);
  const rowsOf = Object.values(schema.tables).map((t) => {
    const fields = [
      "id: number;",
      ...(t.parent ? [`${t.parent.fkColumn}: number;`] : []),
      ...Object.entries(t.columns).map(([c, d]) => `${c}: ${TS[d.type] ?? "unknown"}${d.nullable ? " | null" : ""};`),
    ];
    return `export type ${pascal(t.docKey)}Row = { ${fields.join(" ")} };`;
  });
  const shapes = docs.map((d) => {
    const name = pascal(d.prefix.replace(/:$/, ""));
    const parts = [`${d.root}: ${pascal(d.root)}Row;`, ...d.include.map((c) => `${c}: Record<string, ${pascal(c)}Row>;`)];
    return `export type ${name}Doc = { ${parts.join(" ")} };`;
  });
  return [
    sourceOf(model, from).replace("// The model, as delta's definitions: written by `dzql model` from the model's page.", "// The model, now: delta's definitions, a row type per table and each document's shape. Written by `dzql model` from the model's page; never edited by hand."),
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
export function nextMigrationOf(history: { changes?: Change[] }[], model: Model): { name: string; source: string } | undefined {
  const { changes, byHand } = diff(stateOf(history), definitionsOf(model).schema);
  if (!changes.length && !byHand.length) return undefined;
  const keys = [...new Set(changes.map((c) => c.key))].slice(0, 3).join("-") || "by-hand";
  return { name: `${String(history.length + 1).padStart(3, "0")}-${keys}`, source: writeMigration(changes, byHand) };
}

type Said = { entity: string; op: "add" | "replace" | "remove"; path?: string; to?: string };
type Story = ModelStory & { post?: string | null; writes?: Said[] | null; requires?: { entity: string; path: string; value: string }[] | null };

type Write = { doc: string; ops: Record<string, unknown>[] };
/** One story as the tests tell it: its write on the document it is born into, the writes it needs first (in order, each with its teller), and the documents it is born into. */
type Planned = { s: Story; write?: Write; premise: { who: string; write: Write }[]; serving: ModelDocument[] };

/**
 * Each story, planned: the write on the document it is born into (one its teller holds, if any),
 * at row 1 of what it changes and under row 1 of the parent it adds under; and its premise, the
 * stories it needs -- whoever adds the row it changes or adds under, or sets the state it
 * requires -- each after what it needs in turn.
 */
function planOf(model: Model): Planned[] {
  const { schema } = definitionsOf(model);
  const documents = rows(model.documents);
  const stories = rows(model.stories as Record<string, Story> | Story[] | undefined);
  const parentOf = (e: string) => schema.tables[e]?.parent?.collection;
  const serving = (s: Story) => documents.filter((d) => (d.stories ?? []).map(String).includes(String(s.id)));
  // the document the write is made on: one the teller holds, and one where what it writes is a row of
  // a collection rather than the document's own root (adding a table is done on a page of tables)
  const docFor = (s: Story, entity: string) => {
    const by = serving(s).filter((d) => entity in (d.holds ?? {}));
    const rank = (d: ModelDocument) => ((d.held_by ?? []).includes(s.actor) ? 0 : 2) + (d.root === entity ? 1 : 0);
    return [...by].sort((x, y) => rank(x) - rank(y))[0];
  };
  // a value a replace with none said can set: one of the field's type
  const sample = (entity: string, field?: string) => {
    const type = field && schema.tables[entity]?.columns[field]?.type;
    return type === "integer" || type === "real" ? 1 : type === "boolean" ? true : type === "json" ? {} : "changed";
  };
  const opOf = (d: ModelDocument, w: Said) => {
    if (w.entity === d.root) return w.path ? { op: "replace", path: `/${w.entity}/${w.path}`, value: w.to ?? sample(w.entity, w.path) } : { op: w.op, path: `/${w.entity}` };
    if (w.op === "add") {
      const parent = parentOf(w.entity);
      return { op: "add", path: `/${w.entity}/-`, value: { ...(parent ? { [`${parent}_id`]: 1 } : {}), ...(w.path ? { [w.path]: w.to ?? null } : {}) } };
    }
    return w.op === "remove" ? { op: "remove", path: `/${w.entity}/1${w.path ? `/${w.path}` : ""}` } : { op: "replace", path: `/${w.entity}/1/${w.path}`, value: w.to ?? sample(w.entity, w.path) };
  };
  const writeOf = (s: Story): Write | undefined => {
    const ws = s.writes ?? [];
    const d = ws.length ? docFor(s, ws[0]!.entity) : undefined;
    return d && { doc: `${d.name}:1`, ops: ws.map((w) => opOf(d, w)) };
  };
  // whoever a story needs first: the stories that add the rows it changes or adds under, or set the state it requires
  const direct = (s: Story): Story[] => {
    const want = new Set<string>();
    for (const w of s.writes ?? []) {
      if (w.op !== "add") want.add(`add ${w.entity}`);
      const p = parentOf(w.entity);
      if (w.op === "add" && p) want.add(`add ${p}`);
    }
    for (const r of s.requires ?? []) want.add(`${r.entity}.${r.path}=${r.value}`);
    return stories.filter((o) => o !== s && o.kind !== "cannot" && (o.writes ?? []).some((w) => (w.op === "add" && want.has(`add ${w.entity}`)) || want.has(`${w.entity}.${w.path}=${w.to}`)));
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
  return stories.map((s) => ({ s, write: s.post ? undefined : writeOf(s), premise: needs(s).flatMap((o) => (writeOf(o) ? [{ who: o.actor, write: writeOf(o)! }] : [])), serving: serving(s) }));
}

const lit = (v: unknown) => JSON.stringify(v);

/**
 * The model, proved on a store: `model.test.ts`. The migrations, run from empty on SQLite, are the
 * schema the types describe (no drift); and each story's write, after the writes it needs in order,
 * lands on its document and is there in every document each person it tells holds. No page is
 * needed: it is the model's definitions under delta, as an app keeps them. The app's own stories,
 * each saying its model story's number, are told against its pages.
 */
export function testsOf(model: Model, app = "model"): string {
  const holds = (d: ModelDocument, w: Said) => w.entity in (d.holds ?? {}) && (!w.path || (d.holds![w.entity]!.fields ?? []).some((f) => f.name === w.path));
  const cases = planOf(model).flatMap(({ s, write, premise, serving }) => {
    if (!write || s.kind === "cannot") return [];
    const told = [...new Set([s.actor, ...serving.flatMap((d) => d.held_by ?? [])])];
    // what is there after the whole write: an entity the same write removes is checked as nothing more
    const removed = new Set((s.writes ?? []).filter((w) => w.op === "remove" && !w.path).map((w) => w.entity));
    const checks = (s.writes ?? []).filter((w) => !removed.has(w.entity)).flatMap((w) =>
      told.flatMap((who) =>
        serving.filter((d) => (d.held_by ?? []).includes(who) && holds(d, w)).map((d) => ({ who, doc: `${d.name}:1`, entity: w.entity, ...(w.path ? { path: w.path, to: w.to ?? null } : {}), root: d.root === w.entity })),
      ),
    );
    return [`  [${lit(s.text)}, ${lit(premise.map((p) => p.write))}, ${lit(write)}, ${lit(checks)}],`];
  });
  return [
    "// The model, proved on a store: written by `dzql model` from the model's page; never edited by hand.",
    'import { Database } from "bun:sqlite";',
    'import { describe, expect, test } from "bun:test";',
    'import { createLocal } from "@blueshed/delta/local";',
    'import { diff, stateOf } from "@blueshed/delta/migrations";',
    'import { fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";',
    'import { docs, schema } from "./types";',
    "",
    "const migrations = await fromFolder(`${import.meta.dir}/migrations`);",
    "async function store() {",
    '  const db = new Database(":memory:");',
    `  const { drift } = await migrate(db, migrations, { app: ${lit(app)}, schema });`,
    "  const local = createLocal();",
    "  registerDocs(local.server, db, schema, docs);",
    "  return { drift, local };",
    "}",
    "",
    'test("the migrations, from empty, are the schema the types describe", async () => {',
    "  expect(diff(stateOf(migrations), schema)).toEqual({ changes: [], byHand: [] });",
    "  expect((await store()).drift).toEqual([]);",
    "});",
    "",
    "type Write = { doc: string; ops: unknown[] };",
    "type Check = { who: string; doc: string; entity: string; path?: string; to?: unknown; root: boolean };",
    "const cases: [string, Write[], Write, Check[]][] = [",
    ...cases,
    "];",
    "",
    'describe("each story, on the store", () => {',
    "  for (const [name, premise, does, checks] of cases)",
    "    test(name, async () => {",
    "      const { local } = await store();",
    "      // a write goes to a document its writer has open, as on a page",
    '      const write = async (w: Write) => (await local.call("open", { doc: w.doc }), await local.call("delta", w));',
    "      for (const w of premise) expect(await write(w)).toEqual({ result: { ack: true } });",
    "      expect(await write(does)).toEqual({ result: { ack: true } });",
    "      for (const c of checks) {",
    '        const doc = (await local.call("open", { doc: c.doc })).result as Record<string, any>;',
    "        const rows = c.root ? [doc[c.entity]] : Object.values(doc[c.entity] ?? {});",
    '        expect(rows.some((r: any) => r && (c.path === undefined || r[c.path] === c.to)), `${c.who} sees ${c.entity}${c.path ? `.${c.path} = ${c.to}` : ""} in ${c.doc}`).toBe(true);',
    "      }",
    "    });",
    "});",
    "",
  ].join("\n");
}
