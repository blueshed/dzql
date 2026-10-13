import { read as readDoc } from "../../src/documents";
import type { PatchOp } from "../../src/json-patch";
import { parsePointer } from "../../src/json-pointer";
import { refuse } from "../../src/refusal";

// modeling's documents as its page reads them, and the rules a write follows. The model
// (`model:1`): its stories, and the documents they need -- what each holds, who holds it, which
// stories it serves. The entities are worked out from the documents (`derive`), never kept, so
// they cannot disagree with them. A session (`session:<id>`): who is signed in, if anyone, and
// what they have picked to see what goes with it.

/** The one model. */
export const MODEL = "1";

export type Field = { name: string; type: string };
export type Story = { id: string; text: string };
export type Document = { id: string; name: string; holds: Record<string, Field[]>; held_by: string[]; stories: string[] };
export type Model = { name: string; stories: Story[]; documents: Document[] };

type Row<T> = T & { id: string | number };

/** The model as delta holds it, with every id as text, the wire's own, and each in the order it was made. */
export function model(): Model {
  const doc = readDoc<{ models: { name: string }; stories: Record<string, Row<{ text: string }>>; documents: Record<string, Row<Omit<Document, "id">>> }>(`model:${MODEL}`);
  const byId = (a: { id: string }, b: { id: string }) => Number(a.id) - Number(b.id);
  const stories = Object.values(doc.stories).map((s) => ({ id: String(s.id), text: s.text })).sort(byId);
  const documents = Object.values(doc.documents)
    .map((d) => ({ id: String(d.id), name: d.name, holds: d.holds ?? {}, held_by: d.held_by ?? [], stories: (d.stories ?? []).map(String) }))
    .sort(byId);
  return { name: doc.models.name, stories, documents };
}

// ───────────────────────────── what is worked out ─────────────────────────────

export type Entity = { name: string; fields: Field[]; documents: string[] };

/**
 * What the documents say, read the other way: each entity a document holds, its fields (every
 * field any document gives it, first named first), and the documents that hold it; and the gaps --
 * a story no document serves, a document that serves no story still told, an entity held only by
 * such documents.
 */
export function derive(m: Model) {
  const told = new Set(m.stories.map((s) => s.id));
  const serves = (d: Document) => d.stories.filter((id) => told.has(id));
  const entities = new Map<string, Entity>();
  for (const d of m.documents) {
    for (const [name, fields] of Object.entries(d.holds)) {
      const e = entities.get(name) ?? entities.set(name, { name, fields: [], documents: [] }).get(name)!;
      e.documents.push(d.id);
      for (const f of fields) if (!e.fields.some((g) => g.name === f.name)) e.fields.push(f);
    }
  }
  const needed = new Set(m.documents.filter((d) => serves(d).length > 0).map((d) => d.id));
  return {
    entities: [...entities.values()].sort((a, b) => a.name.localeCompare(b.name)),
    /** The ids of the documents that serve a story still told. */
    needed,
    /** The documents serving each story. */
    servedBy: (story: string) => m.documents.filter((d) => d.stories.includes(story)).map((d) => d.id),
    /** The stories still told that a document serves. */
    serves,
  };
}

export type Derived = ReturnType<typeof derive>;

/** What is picked: a story, a document or an entity, by its id (an entity's is its name). */
export type Chosen = { k: "story" | "document" | "entity"; id: string };

export const chosenOf = (value: string | null | undefined): Chosen | undefined => {
  const [k, id] = String(value ?? "").split(":");
  return (k === "story" || k === "document" || k === "entity") && id ? { k, id } : undefined;
};

/** What goes with what is picked, in each column: the stories, the documents (by id) and the entities (by name). */
export function related(m: Model, d: Derived, c: Chosen): { stories: Set<string>; documents: Set<string>; entities: Set<string> } {
  const docs = c.k === "document" ? [c.id] : c.k === "story" ? d.servedBy(c.id) : d.entities.find((e) => e.name === c.id)?.documents ?? [];
  const held = m.documents.filter((x) => docs.includes(x.id));
  return {
    stories: new Set(c.k === "story" ? [c.id] : held.flatMap(d.serves)),
    documents: new Set(docs),
    entities: new Set(c.k === "entity" ? [c.id] : held.flatMap((x) => Object.keys(x.holds))),
  };
}

// ───────────────────────────── the model's rules ─────────────────────────────

const words = (value: unknown, why: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw refuse(why);
  return text;
};

/** Names, from a list of them: each trimmed, a blank dropped. */
const names = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);

/** A field as a document holds it: a name, and a type ("text" unless it says). */
const fieldsOf = (value: unknown): Field[] =>
  (Array.isArray(value) ? value : []).flatMap((f) => {
    const name = String((f as Partial<Field>)?.name ?? "").trim();
    return name ? [{ name, type: String((f as Partial<Field>).type ?? "").trim() || "text" }] : [];
  });

/** The stories a document is for: ids the model has, at least one. */
function storiesOf(m: Model, value: unknown): string[] {
  const ids = names(value).filter((id) => m.stories.some((s) => s.id === id));
  if (ids.length === 0) throw refuse("A document is for a story: name the one it serves.");
  return ids;
}

/**
 * A write to the model as it takes it. A story: added, reworded or taken back, never without
 * words. A document: described with its name and the stories it serves (one at least); what it
 * holds, an entity at a time with its fields; who holds it; the stories it serves; taken out.
 */
export function shape(m: Model, ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [coll, id, field, entity] = parsePointer(op.path);
    if (coll === "stories") {
      if (op.op === "add") return [{ op: "add", path: "/stories/-", value: { text: words(op.value, "A story needs words.") } }];
      if (op.op === "remove") return [op];
      return field === "text" ? [{ op: "replace", path: op.path, value: words(op.value, "A story needs words.") }] : [];
    }
    if (op.op === "add") {
      const said = (op.value ?? {}) as Partial<Document>;
      const name = words(said.name, "A document needs a name.");
      return [{ op: "add", path: "/documents/-", value: { name, stories: storiesOf(m, said.stories), holds: {}, held_by: names(said.held_by) } }];
    }
    if (op.op === "remove" && field === undefined) return [op];
    const doc = m.documents.find((d) => d.id === id)!;
    if (field === "name") return [{ op: "replace", path: op.path, value: words(op.value, "A document needs a name.") }];
    if (field === "held_by") return [{ op: "replace", path: op.path, value: names(op.value) }];
    if (field === "stories") return [{ op: "replace", path: op.path, value: storiesOf(m, op.value) }];
    // what it holds, an entity at a time: its fields, or taken out
    const holds = { ...doc.holds };
    if (op.op === "remove") delete holds[entity!];
    else holds[words(entity, "An entity needs a name.")] = fieldsOf(op.value);
    return [{ op: "replace", path: `/documents/${id}/holds`, value: holds }];
  });
}

/** May this op be written at all: a story or a document the model has (or a new one), and only their own fields. */
export function may(m: Model, op: PatchOp): boolean {
  const [coll, id, field, entity, ...more] = parsePointer(op.path);
  if (more.length > 0) return false;
  if (coll === "stories") {
    if (id === "-") return op.op === "add" && field === undefined;
    if (!m.stories.some((s) => s.id === id)) return false;
    return field === undefined ? op.op === "remove" : field === "text" && op.op === "replace" && entity === undefined;
  }
  if (coll !== "documents") return false;
  if (id === "-") return op.op === "add" && field === undefined;
  if (!m.documents.some((d) => d.id === id)) return false;
  if (field === undefined) return op.op === "remove";
  if (field === "holds") return entity !== undefined && (op.op === "replace" || op.op === "remove");
  return (field === "name" || field === "held_by" || field === "stories") && op.op === "replace" && entity === undefined;
}

// ───────────────────────────── the session ─────────────────────────────

export type Person = { id: string; name: string };
export type Session = { person: Person | null; chosen: Chosen | undefined };

/** Who a session is, if anyone, and what they have picked. */
export function session(sessionId: string): Session {
  const row = readDoc<{ sessions?: { person_id?: string | null; name?: string | null; chosen?: string | null } }>(`session:${sessionId}`)?.sessions ?? {};
  return row.person_id == null ? { person: null, chosen: undefined } : { person: { id: String(row.person_id), name: row.name ?? "" }, chosen: chosenOf(row.chosen) };
}
