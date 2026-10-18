import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { refuse } from "dzql/rendering/refusal";
import type { Field, Held, Raw, Requires, StoryWrite } from "./heart";

// modeling's documents as its page reads them, and the rules a write to the model follows. The
// model (`model:1`): its stories and the documents they need, as delta keeps them (`Raw`); the
// heart is worked out from it (./heart.ts). A session (`session:<id>`): who is signed in, if anyone.

/** The one model. */
export const MODEL = "1";

/** The model document as delta holds it. */
export const raw = (): Raw => readDoc<Raw>(`model:${MODEL}`);

type Story = { id: string; touches: string[] };
type Document = { id: string; root: string; holds: Record<string, Held> };
/** What the rules need of the model: its stories and documents, by id. */
export type Model = { stories: Story[]; documents: Document[] };

export function model(r: Raw = raw()): Model {
  return {
    stories: Object.values(r.stories ?? {}).map((s) => ({ id: String(s.id), touches: s.touches ?? [] })),
    documents: Object.values(r.documents ?? {}).map((d) => ({ id: String(d.id), root: d.root, holds: d.holds ?? {} })),
  };
}

// ───────────────────────────── the model's rules ─────────────────────────────

const words = (value: unknown, why: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw refuse(why);
  return text;
};

/** A story's words, on one line: a shell quote left open (an apostrophe in words not quoted) would run the commands after it into one story. */
const line = (value: unknown): string => {
  const text = words(value, "A story needs words.");
  if (/[\r\n]/.test(text)) throw refuse("A story is one line: these words run onto a second.");
  return text;
};

/** Names, from a list of them: each trimmed, a blank dropped. */
const names = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);

/** Fields as a document holds them: a name, and a type ("text" unless it says). */
const fieldsOf = (value: unknown): Field[] =>
  (Array.isArray(value) ? value : []).flatMap((f) => {
    const name = String((f as Partial<Field>)?.name ?? "").trim();
    return name ? [{ name, type: String((f as Partial<Field>).type ?? "").trim() || "text" }] : [];
  });

const VERBS = new Set(["add", "replace", "remove"]);
const ident = (v: unknown) => String(v ?? "").trim();

/** What a story writes, as hjeli said it: each an entity and a verb, and for a replace the field and the value it sets, if said. */
const writesOf = (value: unknown): StoryWrite[] =>
  (Array.isArray(value) ? value : []).map((w) => {
    const said = (w ?? {}) as Partial<StoryWrite>;
    const entity = ident(said.entity);
    if (!entity || !VERBS.has(String(said.op))) throw refuse("A write names an entity and add, replace or remove.");
    const path = ident(said.path);
    const to = said.to === undefined || said.to === null ? "" : String(said.to).trim();
    return { entity, op: said.op as StoryWrite["op"], ...(path && { path }), ...(to && { to }) };
  });

/** The states a story presupposes: each an entity's field and the value it holds. */
const requiresOf = (value: unknown): Requires[] =>
  (Array.isArray(value) ? value : []).map((r) => {
    const said = (r ?? {}) as Partial<Requires>;
    const [entity, path, v] = [ident(said.entity), ident(said.path), ident(said.value)];
    if (!entity || !path || !v) throw refuse("A state a story presupposes names an entity, its field and the value.");
    return { entity, path, value: v };
  });

/** Whether a story is done or refused: `does` unless it says `cannot`. */
const kindOf = (value: unknown): string => (value === "cannot" ? "cannot" : "does");

/** The stories a document is for: ids the model has, at least one. */
function storiesOf(m: Model, value: unknown): number[] {
  const ids = names(value).filter((id) => m.stories.some((s) => s.id === id)).map(Number);
  if (ids.length === 0) throw refuse("A document is for a story: name the one it serves.");
  return ids;
}

type Said = { text?: unknown; actor?: unknown; kind?: unknown; post?: unknown; touches?: unknown; name?: unknown; root?: unknown; stories?: unknown; held_by?: unknown; own?: unknown; under?: unknown; fields?: unknown };

/**
 * A write to the model as it takes it. A story: written down with its words, who tells it, and
 * whether they do it or are refused (and a route it posts to, the entities it touches, and, as hjeli
 * had them, what it writes and the states it presupposes); reworded,
 * retold, taken back -- never without words, nor on more than one line. A document: described with its name, its root and
 * the stories it serves (one at least); what it holds, an entity at a time with what it hangs under
 * and its fields; who holds it; whether it is each person's own; taken out. Its root stays.
 */
export function shape(m: Model, ops: PatchOp[]): PatchOp[] {
  return ops.flatMap((op): PatchOp[] => {
    const [coll, id, field, entity] = splitPath(op.path);
    const said = (op.value ?? {}) as Said;
    if (coll === "stories") {
      if (op.op === "add") {
        const text = line(said.text);
        const post = typeof said.post === "string" && said.post.trim() ? said.post.trim() : null;
        return [{ op: "add", path: "/stories/-", value: { text, actor: words(said.actor, "A story is someone's: say who tells it."), kind: kindOf(said.kind), post, touches: names(said.touches) } }];
      }
      if (op.op === "remove") return [op];
      if (field === "text") return [{ op: "replace", path: op.path, value: line(op.value) }];
      if (field === "actor") return [{ op: "replace", path: op.path, value: words(op.value, "A story is someone's: say who tells it.") }];
      if (field === "kind") return [{ op: "replace", path: op.path, value: kindOf(op.value) }];
      if (field === "writes") return [{ op: "replace", path: op.path, value: writesOf(op.value) }];
      if (field === "requires") return [{ op: "replace", path: op.path, value: requiresOf(op.value) }];
      return [{ op: "replace", path: op.path, value: names(op.value) }]; // touches
    }
    if (op.op === "add") {
      const name = words(said.name, "A document needs a name.");
      const root = words(said.root, "A document holds something: name its root.");
      return [{ op: "add", path: "/documents/-", value: { name, root, own: said.own ? 1 : 0, stories: storiesOf(m, said.stories), holds: { [root]: { parent: null, fields: fieldsOf(said.fields) } }, held_by: names(said.held_by) } }];
    }
    if (op.op === "remove" && field === undefined) return [op];
    const doc = m.documents.find((d) => d.id === id)!;
    if (field === "name") return [{ op: "replace", path: op.path, value: words(op.value, "A document needs a name.") }];
    if (field === "held_by") return [{ op: "replace", path: op.path, value: names(op.value) }];
    if (field === "stories") return [{ op: "replace", path: op.path, value: storiesOf(m, op.value) }];
    if (field === "own") return [{ op: "replace", path: op.path, value: op.value ? 1 : 0 }];
    // what it holds, an entity at a time: what it hangs under (the root, unless it says) and its fields; or taken out, but never its root
    const holds = { ...doc.holds };
    const name = words(entity, "An entity needs a name.");
    if (op.op === "remove") {
      if (name === doc.root) throw refuse("A document keeps its root: take the document out instead.");
      delete holds[name];
    } else {
      const under = typeof said.under === "string" && said.under.trim() ? said.under.trim() : doc.root;
      holds[name] = { parent: name === doc.root ? null : under, fields: fieldsOf(said.fields) };
    }
    return [{ op: "replace", path: `/documents/${id}/holds`, value: holds }];
  });
}

const STORY_FIELDS = new Set(["text", "actor", "kind", "touches", "writes", "requires"]);
const DOCUMENT_FIELDS = new Set(["name", "held_by", "stories", "own"]);

/** May this op be written at all: a story or a document the model has (or a new one), and only their own fields. */
export function may(m: Model, op: PatchOp): boolean {
  const [coll, id, field, entity, ...more] = splitPath(op.path);
  if (more.length > 0) return false;
  if (coll === "stories") {
    if (id === "-") return op.op === "add" && field === undefined;
    if (!m.stories.some((s) => s.id === id)) throw refuse(`No story ${id}: stories go by their number (show lists them)`);
    return field === undefined ? op.op === "remove" : STORY_FIELDS.has(field) && op.op === "replace" && entity === undefined;
  }
  if (coll !== "documents") return false;
  if (id === "-") return op.op === "add" && field === undefined;
  if (!m.documents.some((d) => d.id === id)) throw refuse(`No document ${id}: documents go by their number, not their name (show lists them)`);
  if (field === undefined) return op.op === "remove";
  if (field === "holds") return entity !== undefined && (op.op === "replace" || op.op === "remove");
  return DOCUMENT_FIELDS.has(field) && op.op === "replace" && entity === undefined;
}

// ───────────────────────────── the session ─────────────────────────────

export type Person = { id: string; name: string };

/** Who a session is, if anyone. */
export function session(sessionId: string): { person: Person | null } {
  const row = readDoc<{ sessions?: { person_id?: string | null; name?: string | null } }>(`session:${sessionId}`)?.sessions ?? {};
  return { person: row.person_id == null ? null : { id: String(row.person_id), name: row.name ?? "" } };
}
