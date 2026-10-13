// Stories read as a hjeli model, so hjeli's six predicates can run over them (Workshop/docs/eta-modeller.md).
//
// eta's stories speak the wire: a session, a `{doc, ops}` write, and who then notices it, where.
// hjeli's predicates speak a model: actors, entities, and the writes each story makes. This reads
// the first into the second, and the predicates run unchanged. What the stories cannot say, it does not invent: it leaves the field out and says so
// in `notes`, so a gap is never an artefact dressed as a finding.
//
// The reading, in one line each:
//   actor      -- every cast name, and every `as` the cast forgot
//   entity     -- a collection a write lands in: the document, or a child collection on its path
//                 (named by its whole chain, `VenueArea`, so two documents' "venues" never merge)
//   field      -- a path's first name after its row, and the keys of a row that is added
//   story      -- `as` is the actor, the writes are `does` read as above; a `cannot` has no writes
//                 (it is the permit table's), nor does a tab closing
//
// Documents are not read here: who holds which, and who is told, is documents.ts's, from the
// stories, the example's compartments and a run. So the model has none, and the predicates that
// ask what a document watches are not run over it (report.ts).
//
// No example knowledge: the one document left out is the session's, found by asking the example's
// own `goTo()` where it writes.

import { writeOf, type Stories, type Story, type Write } from "../../../src/stories";
import type { PatchOp } from "../../../src/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { typeOf as docType } from "./documents";
import type { Entity, Field, Model, Story as ModelStory, StoryWrite } from "./model/grammar";

/** Something the stories do not say, and so the reading leaves out rather than invents. */
export type Note = { kind: string; where: string; detail: string };

export type Reading = {
  model: Model;
  /** Entity name -> the path it was read from (`venue/areas`). */
  collections: Map<string, string>;
  /** The document left out as the session's, if the example has a `goTo()`. */
  session?: string;
  notes: Note[];
};

const isRow = (seg: string): boolean => seg === "-" || /^\d+$/.test(seg);

/** "areas" -> "Area", "series" -> "Series", "work_windows" -> "WorkWindow", "venueOwner" -> "VenueOwner". */
import { singular } from "../heart";
export { singular }; // one rule for a word's one: the modeling page's

export function pascal(word: string): string {
  return word
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

/** One op, located: the collection chain it lands in and the field it names, if any. */
export type Located = { chain: string[]; field?: string; row: boolean };

/** Walk a pointer: a row segment selects a row; a name followed by a row is a child collection; any other name is the field (the rest is inside it). */
export function locate(doc: string, path: string): Located {
  const segs = splitPath(path);
  const chain = [docType(doc)]; // by its type: Japan (ask:1) and the picnic (ask:2) are one entity
  let row = false;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (isRow(seg)) {
      row = true;
      continue;
    }
    const next = segs[i + 1];
    if (next !== undefined && isRow(next)) {
      chain.push(seg);
      row = false;
      continue;
    }
    return { chain, field: seg, row };
  }
  return { chain, row };
}

export const entityOf = (chain: string[]): string => chain.map((c) => pascal(singular(c))).join("");

const scalar = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

function typeOf(v: unknown): string {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "string";
}

/** A write's reading as hjeli story writes, and the fields (with a value's type) it shows its entity has. */
export function readOp(doc: string, op: PatchOp): { write: StoryWrite; fields: [string, unknown][] } {
  const { chain, field } = locate(doc, op.path);
  const entity = entityOf(chain);
  const value = "value" in op ? op.value : undefined;
  if (field === undefined) {
    // A row, whole: added, replaced or removed. Its keys are its fields.
    const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
    return { write: { entity, op: op.op as StoryWrite["op"] }, fields: keys };
  }
  const write: StoryWrite = { entity, op: op.op as StoryWrite["op"], path: field };
  if (op.op !== "remove" && scalar(value)) write.to = String(value);
  return { write, fields: [[field, value]] };
}

/** Who notices, and where: a list leaves each where the cast put them. */
export function noticing(story: Story): [string, string | undefined][] {
  const seen = story.seen ?? [];
  return Array.isArray(seen) ? seen.map((m) => [m, undefined]) : Object.entries(seen);
}

export function fromStories(stories: Stories): Reading {
  const notes: Note[] = [];
  const session = stories.goTo?.("").doc;
  const collections = new Map<string, string>();
  const fields = new Map<string, Map<string, unknown>>(); // entity -> field -> a value seen
  const modelStories: ModelStory[] = [];

  const writesOf = (w: Write): StoryWrite[] =>
    w.ops.map((op) => {
      const { write, fields: fs } = readOp(w.doc, op);
      collections.set(write.entity, locate(w.doc, op.path).chain.join("/"));
      const known = fields.get(write.entity) ?? new Map<string, unknown>();
      for (const [name, value] of fs) if (known.get(name) === undefined) known.set(name, value);
      fields.set(write.entity, known);
      return write;
    });

  const members = new Set(Object.keys(stories.cast));
  for (const s of stories.stories) {
    if (!members.has(s.as)) {
      notes.push({ kind: "uncast-author", where: s.name, detail: `"${s.as}" tells a story but is not in the cast` });
      members.add(s.as);
    }
  }

  for (const s of stories.stories) {
    const w = s.does && writeOf(s);
    if (!w) {
      modelStories.push({ actor: s.as, action: s.name, writes: [], opens: [] });
      continue;
    }
    if (w.doc === session) {
      notes.push({ kind: "session-story", where: s.name, detail: `writes only the session (${session}), which is the page's state, not the model's` });
      modelStories.push({ actor: s.as, action: s.name, writes: [], opens: [] });
      continue;
    }
    for (const [member] of noticing(s)) {
      if (!members.has(member)) notes.push({ kind: "uncast-member", where: s.name, detail: `"${member}" notices but is not in the cast` });
    }
    for (const member of s.untold ?? []) {
      if (!members.has(member)) notes.push({ kind: "uncast-member", where: s.name, detail: `"${member}" must not notice but is not in the cast` });
    }
    modelStories.push({ actor: s.as, action: s.name, writes: writesOf(w), opens: [] });
  }

  // Entities, with an id and every field a write showed. A `_id` field is a reference when it
  // names exactly one collection the stories write, by the collection's own name (`area_id` ->
  // the `areas` under a venue). Two candidates are the same thing seen through two documents, or
  // two things; the stories cannot say which, so it is left a plain field and noted.
  const byOwnName = new Map<string, string[]>();
  for (const [entity, path] of collections) {
    const own = pascal(singular(path.split("/").at(-1)!)).toLowerCase();
    byOwnName.set(own, [...(byOwnName.get(own) ?? []), entity]);
  }
  const entities: Entity[] = [...fields.entries()].map(([name, known]) => {
    const fs: Field[] = [{ name: "id", type: "id" }];
    for (const [field, value] of known) {
      if (field === "id") continue;
      const ref = field.match(/^(.+)_id$/)?.[1];
      if (ref) {
        const whole = pascal(ref).toLowerCase();
        const tail = pascal(ref.split("_").at(-1)!).toLowerCase();
        const candidates = byOwnName.get(whole) ?? byOwnName.get(tail) ?? [];
        if (candidates.length === 1) {
          fs.push({ name: field, type: "id", fk: `${candidates[0]}.id` });
          continue;
        }
        notes.push(
          candidates.length
            ? { kind: "ambiguous-reference", where: `${name}.${field}`, detail: `could be ${candidates.join(" or ")}` }
            : { kind: "unresolved-reference", where: `${name}.${field}`, detail: `names no collection the stories write` },
        );
      }
      fs.push({ name: field, type: typeOf(value) });
    }
    return { name, fields: fs };
  });

  return {
    model: {
      actors: [...members].map((name) => ({ name, auth_claim: "session" })),
      entities,
      documents: [],
      stories: modelStories,
    },
    collections,
    session,
    notes,
  };
}
