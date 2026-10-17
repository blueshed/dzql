/**
 * Document-first authoring grammar (the restored spine).
 *
 * hjeli is, at the surface a modeller authors, **two nouns over the entity floor**:
 *
 *   - **documents** — what an actor *watches*: a read facet (a `DocNode` view over collections).
 *     This is the thing you `open`; the substrate keeps it live.
 *   - **actions** — what an actor *does*: guards + writes to collections. First-class and
 *     **not bound to a single document** — an action writes collections, and *every* document
 *     watching those collections receives the atomic echo (a transfer touches two account
 *     documents at once; the action belongs to neither).
 *
 * The seam between them is **subscription closure**: every write an action makes must close into
 * some document being watched — across the set, N documents per action when needed.
 *
 * This module is the AUTHORING surface. The proven engine (predicates + generators) ranges over
 * the v2 `operations` representation, so `lowerToOperations` collapses the two nouns into that one
 * internal form: a document → an operation with a `read` facet, an action → an operation with a
 * `write` facet. "operation" is thus a lowering detail, never a noun the modeller handles.
 */
import type { Action, Actor, Document, Entity, Model, Story } from "./grammar";
import { migrateInMemory } from "./migrations";

// `Action` — the document-first write noun — is defined in grammar.ts (a core grammar type) and
// re-exported here so document-first consumers have it alongside `DocModel`.
export type { Action } from "./grammar";

/**
 * A model authored in the document-first grammar: the entity floor, the documents actors watch,
 * the actions they invoke, the actors, and the stories that tie an actor's task to the documents
 * it opens and the action it invokes.
 */
export type DocModel = {
  schemaVersion?: number;
  actors: Actor[];
  entities: Entity[];
  /** What actors watch — read facets. */
  documents: Document[];
  /** What actors do — first-class writes, not subordinate to a document. */
  actions: Action[];
  stories: Story[];
};

/** The grammar version the document-first surface lowers TO (the engine's current operations form). */
const ENGINE_VERSION = 2;

/**
 * Lower the document-first surface to the engine's `operations` representation so the six
 * predicates and the generators run unchanged. A document becomes a read-only operation; an action
 * becomes a write-only operation (carrying its result when it returns one). The legacy
 * `documents[]` engine slot stays empty — both nouns live in `operations` after lowering, and
 * `readFacets`/`writeActions` already unify them across the set (so a transfer's two writes close
 * into two documents with no special case). A story's `action` reference is wired to the engine's
 * `operation` reference.
 */
export function lowerToOperations(m: DocModel): Model {
  return {
    schemaVersion: ENGINE_VERSION,
    actors: m.actors,
    entities: m.entities,
    documents: [],
    operations: [
      ...m.documents.map((d) => ({
        name: d.name,
        actor: d.actor,
        params: d.params,
        read: { node: d.node },
      })),
      ...m.actions.map((a) => ({
        name: a.name,
        actor: a.actor,
        params: a.params,
        write: { preconditions: a.guards, writes: a.writes, ...(a.doc ? { doc: a.doc } : {}) },
        ...(a.result ? { result: a.result } : {}),
      })),
    ],
    // A story names the action it invokes via `operation` (the engine's actor-closure ref); the
    // human `action` label stays. Pass through unchanged — the surface already speaks the engine's
    // story shape.
    stories: m.stories,
  };
}

/**
 * Normalize ANY stored model to the engine's `operations` form, for the read path (predicates,
 * generators, the observatory). A document-first file (`actions` present) is lowered; an older
 * operations/v1 file climbs the migration ladder. One function so the CLI and the observatory agree
 * on what "the model the engine sees" is — no drift.
 */
export function toEngineModel(raw: Model): Model {
  if (Array.isArray(raw.actions)) {
    const lowered = lowerToOperations({
      schemaVersion: raw.schemaVersion,
      actors: raw.actors,
      entities: raw.entities,
      documents: raw.documents ?? [],
      actions: raw.actions,
      stories: raw.stories,
    });
    // A hybrid file may carry BOTH `actions` and a non-empty `operations` (e.g. ops authored
    // against the seed before `init` stripped the key). Keep them — silently dropping a real
    // operations[] would un-prove facets the modeller authored. Existing ops first, mirroring
    // liftDocumentOps' ordering.
    if (raw.operations?.length) lowered.operations = [...raw.operations, ...(lowered.operations ?? [])];
    return lowered;
  }
  return migrateInMemory(raw);
}

/**
 * RAISE an operations model (v1 legacy `documents[]` and/or v2 `operations[]`) to the document-first
 * surface — the inverse of `lowerToOperations`. A read facet becomes a `document`; a write facet
 * becomes an `action`. An operation carrying BOTH yields a document AND an action of the same name
 * (the read is the surface you watch, the write is the action you invoke). Used by `hjeli migrate`
 * to durably adopt the grammar, and so an existing model can be re-expressed in the two nouns.
 */
export function raiseToDocumentFirst(model: Model): DocModel {
  const documents: Document[] = [];
  const actions: Action[] = [];
  // Legacy v1 documents[] are read facets too.
  for (const d of model.documents) documents.push(d);
  for (const o of model.operations ?? []) {
    if (o.read) documents.push({ name: o.name, actor: o.actor, params: o.params, node: o.read.node });
    if (o.write) {
      actions.push({
        name: o.name,
        actor: o.actor,
        params: o.params,
        guards: o.write.preconditions,
        writes: o.write.writes,
        ...(o.write.doc ? { doc: o.write.doc } : {}),
        ...(o.result ? { result: o.result } : {}),
      });
    }
  }
  return { actors: model.actors, entities: model.entities, documents, actions, stories: model.stories };
}
