import { defineDoc, defineSchema, type ColumnShorthand, type DocDef, type Schema } from "@blueshed/delta/backend";

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
const columnType = (type = "text"): ColumnShorthand => TYPES[type.trim().toLowerCase()] ?? "text?";

const rows = <T extends { id: string | number }>(of: Record<string, T> | T[] | undefined): T[] =>
  Object.values(of ?? {}).sort((a, b) => Number(a.id) - Number(b.id));

type Entity = { parent: string | null; columns: Record<string, ColumnShorthand> };

/** The entities, worked out from the documents in the order they were described. */
function entitiesOf(documents: ModelDocument[]): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  for (const d of documents) {
    for (const [name, held] of Object.entries(d.holds ?? { [d.root]: { parent: null } })) {
      const e = entities.get(name) ?? entities.set(name, { parent: name === d.root ? null : (held.parent ?? d.root), columns: {} }).get(name)!;
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
 * The same, as the source of an app's file: what `dzql model export` writes. It imports from
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
    "// The model, as delta's definitions: written by `dzql model export` from the model's page.",
    "// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).",
    `import { defineDoc, defineSchema } from ${JSON.stringify(from)};`,
    "",
    "export const schema = defineSchema({",
    ...tables,
    "});",
    "",
    "export const docs = [",
    ...defs,
    "];",
    "",
  ].join("\n");
}
