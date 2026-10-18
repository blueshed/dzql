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
const pascal = (key: string) => key.replace(/(^|[_-])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

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
export function nextMigrationOf(history: { changes?: Change[] }[], model: Model, owed?: (line: string) => boolean): { name: string; source: string } | undefined {
  const { changes, byHand: all } = diff(stateOf(history), definitionsOf(model).schema);
  // what a person must finish that an earlier step already says is owed there, not here again
  const byHand = all.filter((b) => !owed?.(`// By hand: ${b}`));
  if (!changes.length && !byHand.length) return undefined;
  const keys = [...new Set(changes.map((c) => c.key))].slice(0, 3).join("-") || "by-hand";
  return { name: `${String(history.length + 1).padStart(3, "0")}-${keys}`, source: writeMigration(changes, byHand) };
}

type Said = { entity: string; op: "add" | "replace" | "remove"; path?: string; to?: string };
type Story = ModelStory & { post?: string | null; writes?: Said[] | null; requires?: { entity: string; path: string; value: string }[] | null };

type Write = { doc: string; ops: Record<string, unknown>[] };
/** One story as the tests tell it: its writes, each on a document that holds what it writes, the writes it needs first (in order), and the documents it is born into. */
type Planned = { s: Story; writes: Write[]; premise: Write[]; serving: ModelDocument[] };

/**
 * Each story, planned: its writes on the documents it is born into -- one that holds every entity
 * it writes if there is one, else each write on one that holds its entity -- at row 1 of what it
 * changes and under row 1 of the parent it adds under; and its premise, the stories it needs --
 * whoever adds the row it changes or adds under, or sets the state it requires -- each after what
 * it needs in turn. A value is of its field's type ("false" is false on a boolean).
 */
function planOf(model: Model): { plans: Planned[]; typed: (entity: string, field: string | undefined, v: string | undefined) => unknown } {
  const { schema } = definitionsOf(model);
  const documents = rows(model.documents);
  const stories = rows(model.stories as Record<string, Story> | Story[] | undefined);
  const parentOf = (e: string) => schema.tables[e]?.parent?.collection;
  const serving = (s: Story) => documents.filter((d) => (d.stories ?? []).map(String).includes(String(s.id)));
  const holding = (s: Story, entities: string[]) => serving(s).filter((d) => entities.every((e) => e in (d.holds ?? {})));
  // where a write is made: a page of rows rather than the row's own document (a table is added on
  // the floor), then one the teller holds
  const best = (s: Story, docs: ModelDocument[], entity: string) =>
    [...docs].sort((x, y) => (x.root === entity ? 2 : 0) + ((x.held_by ?? []).includes(s.actor) ? 0 : 1) - ((y.root === entity ? 2 : 0) + ((y.held_by ?? []).includes(s.actor) ? 0 : 1)))[0];
  const typed = (entity: string, field: string | undefined, v: string | undefined): unknown => {
    const type = field ? schema.tables[entity]?.columns[field]?.type : undefined;
    if (v === undefined) return type === "integer" || type === "real" ? 1 : type === "boolean" ? true : type === "json" ? {} : "changed"; // none said: one of its type
    if (type === "boolean") return v === "true" || v === "yes" || v === "1";
    if ((type === "integer" || type === "real") && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return v;
  };
  // the row's own document addresses it by its id (delta: /<root>/<id>), a page of rows by /<collection>/<id>
  const opOf = (d: ModelDocument, w: Said) => {
    const parent = parentOf(w.entity);
    const fields = { ...(parent ? { [`${parent}_id`]: 1 } : {}), ...(w.path ? { [w.path]: typed(w.entity, w.path, w.to) } : {}) };
    // the document's own root is there once the document is open (made by the store, or by the proof
    // for one under a parent), so adding it is setting the field it says, if it says one
    if (w.op === "add" && w.entity === d.root) return w.path ? { op: "replace", path: `/${w.entity}/1/${w.path}`, value: typed(w.entity, w.path, w.to) } : undefined;
    if (w.op === "add") return { op: "add", path: `/${w.entity}/-`, value: fields };
    const row = `/${w.entity}/1`;
    return w.op === "remove" ? { op: "remove", path: `${row}${w.path ? `/${w.path}` : ""}` } : { op: "replace", path: `${row}/${w.path}`, value: typed(w.entity, w.path, w.to) };
  };
  const writesOf = (s: Story): Write[] => {
    const ws = s.writes ?? [];
    if (!ws.length || s.post) return [];
    const all = best(s, holding(s, [...new Set(ws.map((w) => w.entity))]), ws[0]!.entity);
    const groups = new Map<ModelDocument, Said[]>();
    for (const w of ws) {
      const d = all ?? best(s, holding(s, [w.entity]), w.entity);
      if (d) groups.set(d, [...(groups.get(d) ?? []), w]);
    }
    return [...groups].map(([d, said]) => ({ doc: `${d.name}:1`, ops: said.flatMap((w) => opOf(d, w) ?? []) })).filter((w) => w.ops.length > 0);
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
  return { plans: stories.map((s) => ({ s, writes: writesOf(s), premise: needs(s).flatMap(writesOf), serving: serving(s) })), typed };
}

const lit = (v: unknown) => JSON.stringify(v);

/**
 * The model, proved on a store: `model.test.ts`. The migrations, run from empty on SQLite, are the
 * schema the types describe (no drift); and each story's write, after the writes it needs in order,
 * lands on its document and is there in every document each person it tells holds. No page is
 * needed: it is the model's definitions under delta, as an app keeps them. The app's own stories,
 * each saying its model story's number, are told against its pages.
 */
export function testsOf(model: Model, app = "model", types = "./types"): string {
  const holds = (d: ModelDocument, w: Said) => w.entity in (d.holds ?? {}) && (!w.path || (d.holds![w.entity]!.fields ?? []).some((f) => f.name === w.path));
  const { plans, typed } = planOf(model);
  const cases = plans.flatMap(({ s, writes, premise, serving }) => {
    if (!writes.length || s.kind === "cannot") return [];
    const told = [...new Set([s.actor, ...serving.flatMap((d) => d.held_by ?? [])])];
    // what is there after the whole write: an entity the same write removes is checked as nothing more
    const removed = new Set((s.writes ?? []).filter((w) => w.op === "remove" && !w.path).map((w) => w.entity));
    const checks = (s.writes ?? []).filter((w) => !removed.has(w.entity)).flatMap((w) =>
      told.flatMap((who) =>
        serving.filter((d) => (d.held_by ?? []).includes(who) && holds(d, w)).map((d) => ({ who, doc: `${d.name}:1`, entity: w.entity, ...(w.path ? { path: w.path, to: typed(w.entity, w.path, w.to) } : {}), root: d.root === w.entity })),
      ),
    );
    return [`  [${lit(s.text)}, ${lit(premise)}, ${lit(writes)}, ${lit(checks)}],`];
  });
  return [
    "// The model, proved on a store: written by `dzql model` from the model's page; never edited by hand.",
    'import { Database } from "bun:sqlite";',
    'import { describe, expect, test } from "bun:test";',
    'import { createLocal } from "@blueshed/delta/local";',
    'import { diff, stateOf } from "@blueshed/delta/migrations";',
    'import { fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";',
    `import { docs, schema } from ${lit(types)};`,
    "",
    "const migrations = await fromFolder(`${import.meta.dir}/migrations`);",
    "// what a person must finish by hand (a parent changed) is owed by the step that says so",
    "const owed = (await Promise.all([...new Bun.Glob(\"*.ts\").scanSync(`${import.meta.dir}/migrations`)].map((f) => Bun.file(`${import.meta.dir}/migrations/${f}`).text()))).join(\"\\n\");",
    "async function store() {",
    '  const db = new Database(":memory:");',
    `  await migrate(db, migrations, { app: ${lit(app)}, schema });`,
    "  // a document whose root hangs from another is opened at a row that is there: row 1, and each above it",
    "  for (const d of docs) {",
    "    const chain = [];",
    "    for (let t: (typeof schema.tables)[string] | undefined = schema.tables[d.root]; t; t = t.parent ? schema.tables[t.parent.collection] : undefined) chain.unshift(t);",
    "    if (chain.length > 1) for (const t of chain) db.run(`INSERT OR IGNORE INTO \"${t.name}\" (id${t.parent ? `, \"${t.parent.fkColumn}\"` : \"\"}) VALUES (1${t.parent ? \", 1\" : \"\"})`);",
    "  }",
    "  const local = createLocal();",
    "  registerDocs(local.server, db, schema, docs);",
    "  return { local };",
    "}",
    "",
    'test("the migrations, from empty, are the schema the types describe", async () => {',
    "  const { changes, byHand } = diff(stateOf(migrations), schema);",
    "  expect({ changes, byHand: byHand.filter((b) => !owed.includes(`// By hand: ${b}`)) }).toEqual({ changes: [], byHand: [] });",
    "});",
    "",
    "type Write = { doc: string; ops: unknown[] };",
    "type Check = { who: string; doc: string; entity: string; path?: string; to?: unknown; root: boolean };",
    "const cases: [string, Write[], Write[], Check[]][] = [",
    ...cases,
    "];",
    "",
    'describe("each story, on the store", () => {',
    "  for (const [name, premise, does, checks] of cases)",
    "    test(name, async () => {",
    "      const { local } = await store();",
    "      // a write goes to a document its writer has open, as on a page",
    "      const write = async (w: Write) => {",
    '        expect((await local.call("open", { doc: w.doc })).error, `open ${w.doc}`).toBeUndefined();',
    '        return local.call("delta", w);',
    "      };",
    "      for (const w of premise) expect(await write(w), `the premise: ${JSON.stringify(w)}`).toEqual({ result: { ack: true } });",
    "      for (const w of does) expect(await write(w), JSON.stringify(w)).toEqual({ result: { ack: true } });",
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
