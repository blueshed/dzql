// One reading of a model: what it says, worked out once, for everything that takes a model -- the
// checks (examples/modeling/closure.ts), the heart the page draws (examples/modeling/heart.ts), the
// definitions and the proof (./definitions.ts), the guards (./guards.ts). Each once worked these out
// for itself, and they came apart (cafe-e's feedback: the checks said closed and the proof failed;
// the guards refused what the checks called decided). ./conformance.test.ts holds them to each other.
//
//   an entity   each a document holds or a story touches; it hangs from the first parent any
//               document gives it (a document's root says nothing of its parent), and has every
//               field any document gives it, the first type said winning
//   implied     an entity that hangs from nothing and is the root of a document that is one row: its
//               row is there before any story adds it (delta makes it on the document's first write)
//   a list      a document of every row of its root (`menu:`), not one (`menu:1`): its rows are added
//   added       the entities a story that someone does adds
//   who writes  a person writes an entity on a document that holds it and that they hold, or that
//               is each person's own (you may write what you may read)
//   a value     a word a story says (`to`, `requires`), as its field's type has it: "false" on a
//               boolean is false, "2" on an integer is 2
//
// Pure: no store, no page. The page's applet draws with it in the browser.

/** A field as a document holds it: its name, and its type as the modeller said it ("text" unless said). */
export type ModelField = { name: string; type?: string };
/** A write a story says: an entity and a verb, and for a replace the field and the value it sets. */
export type StoryWrite = { entity: string; op: "add" | "replace" | "remove"; path?: string; to?: string };
/** A state a story presupposes: an entity's field holding a value. */
export type Requires = { entity: string; path: string; value: string };
export type ModelStory = { id: string | number; text: string; actor: string; kind?: string; post?: string | null; touches?: string[]; writes?: StoryWrite[] | null; requires?: Requires[] | null };
export type ModelDocument = {
  id: string | number;
  name: string;
  root: string;
  own?: number | boolean;
  /** Every row of its root (`menu:`), not one of them (`menu:1`). */
  list?: number | boolean;
  holds?: Record<string, { parent: string | null; fields?: ModelField[] }>;
  held_by?: string[];
  stories?: (string | number)[];
};
/** A model as its page keeps it: its stories and documents, each a row by its id; a list does as well. */
export type AnyModel = { stories?: Record<string, ModelStory> | ModelStory[]; documents?: Record<string, ModelDocument> | ModelDocument[] };

export type Story = { id: string; text: string; actor: string; kind: "does" | "cannot"; post: string | null; touches: string[]; writes: StoryWrite[]; requires: Requires[] };
export type Held = { parent: string | null; fields: { name: string; type: string }[] };
export type Document = { id: string; name: string; root: string; own: boolean; list: boolean; holds: Record<string, Held>; held_by: string[]; serves: string[]; implied: boolean };
export type Entity = { name: string; parent: string | null; fields: Map<string, string>; documents: string[] };

/** The modeller's words for a type, as delta's: anything else is not a type the model knows. */
const TYPES: Record<string, string> = {
  text: "text", integer: "integer", int: "integer", real: "real", number: "real", boolean: "boolean", bool: "boolean",
  json: "json", timestamptz: "timestamptz", timestamp: "timestamptz", time: "timestamptz", date: "text",
};
/** A type the modeller may say: each maps to one of delta's, and any other is a gap (referential closure), never guessed as text. */
export const knownType = (type = "text"): boolean => type.trim().toLowerCase() in TYPES;
/** delta's type for a modeller's word: text when it is not one. */
export const typeOf = (type = "text"): string => TYPES[type.trim().toLowerCase()] ?? "text";

/** Where an entity hangs, as one document says it: from nothing when it is that document's root, else under its parent (or the root). */
export const parentIn = (d: Pick<ModelDocument, "root">, name: string, held: { parent: string | null }): string | null => (name === d.root ? null : (held.parent ?? d.root));

const rows = <T extends { id: string | number }>(of: Record<string, T> | T[] | undefined): T[] => Object.values(of ?? {}).sort((a, b) => Number(a.id) - Number(b.id));

/** A word as its type has it: a boolean's yes and no, a number's digits; none said, one of its type. */
export function valueOf(type: string | undefined, word: string | undefined): unknown {
  if (word === undefined) return type === "integer" || type === "real" ? 1 : type === "boolean" ? true : type === "json" ? {} : "changed";
  if (type === "boolean") return word === "true" || word === "yes" || word === "1";
  if ((type === "integer" || type === "real") && word.trim() !== "" && !Number.isNaN(Number(word))) return Number(word);
  return word;
}

/** Does a value as a store holds it (SQLite's 0 and 1 for a boolean) say the word, as its type has it? */
export function says(type: string | undefined, stored: unknown, word: string): boolean {
  if (stored === null || stored === undefined) return false;
  const want = valueOf(type, word);
  if (type === "boolean") return (stored === true || stored === 1 || stored === "1" || stored === "true" || stored === "yes") === want;
  return String(stored) === String(want);
}

export type Reading = ReturnType<typeof readingOf>;

/** The model, read once. */
export function readingOf(model: AnyModel) {
  const stories: Story[] = rows(model.stories).map((s) => ({
    id: String(s.id),
    text: s.text,
    actor: s.actor,
    kind: s.kind === "cannot" ? "cannot" : "does",
    post: s.post ?? null,
    touches: s.touches ?? [],
    writes: s.writes ?? [],
    requires: s.requires ?? [],
  }));
  const said = rows(model.documents);
  const documents: Document[] = said.map((d) => ({
    id: String(d.id),
    name: d.name,
    root: d.root,
    own: !!d.own,
    list: !!d.list,
    holds: Object.fromEntries(Object.entries(d.holds ?? { [d.root]: { parent: null } }).map(([e, h]) => [e, { parent: h.parent, fields: (h.fields ?? []).map((f) => ({ name: f.name, type: f.type ?? "text" })) }])),
    held_by: d.held_by ?? [],
    serves: (d.stories ?? []).map(String),
    implied: false, // below, once every parent is known
  }));

  const entities = new Map<string, Entity>();
  const entity = (name: string) => entities.get(name) ?? entities.set(name, { name, parent: null, fields: new Map(), documents: [] }).get(name)!;
  /** Where each entity hangs, as each document says it: one table has one parent, and more is a clash. */
  const parents = new Map<string, Map<string, string[]>>();
  for (const d of documents)
    for (const [name, held] of Object.entries(d.holds)) {
      const e = entity(name);
      const p = parentIn(d, name, held);
      e.parent ??= p; // the first that gives one wins
      if (p) parents.set(name, (parents.get(name) ?? new Map()).set(p, [...(parents.get(name)?.get(p) ?? []), d.name]));
      for (const f of held.fields) if (!e.fields.has(f.name)) e.fields.set(f.name, f.type);
      e.documents.push(d.name);
    }
  for (const s of stories) for (const t of touched(s)) entity(t);
  // a root its holds leave out is still its root; a list has no one row to be there before it
  for (const d of documents) d.implied = !entity(d.root).parent && !d.list;

  const parentOf = (e: string): string | undefined => entities.get(e)?.parent ?? undefined;
  /** An entity and every row it hangs under, nearest first. */
  const above = (e: string): string[] => {
    const chain: string[] = [];
    for (let x: string | undefined = e; x && !chain.includes(x); x = parentOf(x)) chain.push(x);
    return chain;
  };
  const doing = stories.filter((s) => s.kind === "does" && !s.post);
  const heldIn = (e: string) => documents.filter((d) => e in d.holds);
  const story = (id: string) => stories.find((s) => s.id === id);

  return {
    stories,
    documents,
    entities,
    /** Each entity said to hang from more than one parent: by whom. */
    clashes: [...parents].filter(([, by]) => by.size > 1),
    parentOf,
    above,
    heldIn,
    /** The stories someone does on a document (not a form posted to a route). */
    doing,
    /** The entities a story someone does adds. */
    added: new Set(doing.flatMap((s) => s.writes.filter((w) => w.op === "add").map((w) => w.entity))),
    /** Is this entity's row there before any story adds it: an implied document's root, or each person's own (made by the visit)? */
    there: (e: string): boolean => documents.some((d) => d.root === e && (d.implied || d.own)),
    /** The type of an entity's field, as the first document to give it said. */
    typeOf: (e: string, field: string | undefined): string | undefined => (field === undefined ? undefined : typeOf(entities.get(e)?.fields.get(field))),
    /** The documents a person may write an entity on: that hold it and that they hold, or that are each person's own. */
    writable: (who: string, e: string): Document[] => heldIn(e).filter((d) => d.own || d.held_by.includes(who)),
    /** What is in front of a person: what they hold, and their own document where it serves a story of theirs. */
    inFront: (who: string): Document[] => documents.filter((d) => d.held_by.includes(who) || (d.own && d.serves.some((id) => story(id)?.actor === who))),
    /** A document's name on the wire, as the proof opens it: `menu:` for a list, `menu:1` for one row. */
    nameOf: (d: Document): string => `${d.name}:${d.list ? "" : "1"}`,
    /** The documents a story is born into: those that say they serve it. */
    serving: (s: Story): Document[] => documents.filter((d) => d.serves.includes(s.id)),
  };
}

/** What a story touches: what it says it touches, and what it writes. */
export const touched = (s: { touches?: string[]; writes?: StoryWrite[] | null }): string[] => [...new Set([...(s.touches ?? []), ...(s.writes ?? []).map((w) => w.entity)])];
