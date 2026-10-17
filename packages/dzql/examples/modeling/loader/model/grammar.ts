export type Field = {
  name: string;
  type: string;
  fk?: string;
  nullable?: boolean;
  /** This column holds the owning actor's identity (its `fk` target = the actor's
   *  identity entity). Drives authorization closure + generated RLS.
   *
   *  May also carry an OWNERSHIP PATH (or an OR-list of them): a forward-hop string
   *  travelling from this field's value to the acting identity — e.g.
   *  `owner: "->membership[org_id=$]{role=owner}.user_id"`. Referential closure
   *  resolves every reference in the path; authorization closure proves its terminal
   *  reaches the actor; `export sql` lowers it to RLS (see core/paths.ts). `true` is
   *  the bare-fk sugar (this field = the actor, or a group resolved via a `grant`
   *  junction). An array ORs its branches (`true` = the bare-fk branch). */
  owner?: boolean | string | (string | boolean)[];
  /** Pin this FK as the entity's delta structural parent (the lens `include`
   *  path travels through it). When no field is marked, the generator falls back
   *  to the first `fk` field — so declaration order silently decides parentage on
   *  a multi-FK entity. Set `parent: true` on the FK that should win to make the
   *  choice explicit and order-independent. Honoured only on an `fk` field. */
  parent?: boolean;
  /** This entity is a membership/grant junction and this `fk` points to the GROUP
   *  it grants. A row grants its `owner` (the actor identity) access to the group
   *  at this fk — e.g. Membership(user_id owner→User, org_id grant→Organisation)
   *  grants a User access to an Organisation. An `owner` fk elsewhere that targets
   *  such a group resolves *through* this grant → a join RLS policy (access scoped
   *  by membership in the owning group, reads + writes). */
  grant?: boolean;
  /** Relationship-grant junction: this `fk` points to the RESOURCE the junction
   *  grants a group access to. Paired with a `grant` fk (the grantee group) and an
   *  optional `gate` field, every member of that group reaches the resource — e.g.
   *  Promoter(venue_id resource→Venue, org_id grant→Organisation, status gate="accepted")
   *  lets a promoter org's members reach the venue. The resource (and its FK-descendants,
   *  via the ancestor recursion) resolve through the grant in generated RLS, OR'd with
   *  any direct owner. Distinct from `owner`+`grant` (a user→group membership): this is a
   *  group→resource grant. Honoured only on an `fk` field. */
  resource?: boolean;
  /** On a relationship-grant junction (one carrying a `resource` fk), restrict the grant
   *  to rows where this field equals the given value — only those rows confer access (e.g.
   *  `status` `gate: "accepted"`, so pending/disabled rows grant nothing). If the junction
   *  is `temporal`, the grant reads the `current_<table>` view, so flipping the gate revokes
   *  (or restores) access live. Ignored on a junction with no `resource` fk. */
  gate?: string;
};
export type Entity = {
  name: string;
  fields: Field[];
  /** Bitemporal table: delta stamps `valid_from`/`valid_to` on every write and
   *  keeps superseded versions, so the collection has history and a lens over it
   *  answers `delta_open_at(:at)` — the state as-of a date. Default false (a plain
   *  mutable table). The valid_* columns are delta-managed and stripped from
   *  broadcasts, so client row types are unchanged. */
  temporal?: boolean;
};

export type ScalarField = { kind: "scalar"; name: string; source: string };
export type NestedField = {
  kind: "array" | "object" | "aggregate";
  name: string;
  agg?: string;
  node: DocNode;
};
export type DocField = ScalarField | NestedField;

export type DocNode = {
  from: string;
  where?: string;
  order?: string;
  limit?: number;
  fields: DocField[];
};

export type Param = { name: string; source: "auth" | "client"; type: string };
export type Document = { name: string; actor: string; params: Param[]; node: DocNode };

export type Actor = {
  name: string;
  auth_claim: string;
  established_by?: { entity: string; field?: string; op?: "add" | "replace" };
};

export type StoryWrite = {
  entity: string;
  op: "add" | "replace" | "remove";
  path?: string;
  /** The value this write sets `path` to — it *produces* the state `${entity}.${path}=${to}`. */
  to?: string;
};
/** A state a story presupposes before its writes apply. */
export type Precondition = {
  entity: string;
  path: string;
  value: string;
  /** Separation of duties: the actor that produced this state must differ from
   *  the actor of the story that presupposes it (authorization closure, tier 2). */
  byOther?: boolean;
};
export type Story = {
  actor: string;
  action: string;
  writes: StoryWrite[];
  opens: string[];
  /** The operation this story's action resolves to (actor closure, CL3). A story that
   *  invokes an operation's write facet references it here; its loose `writes` then live on
   *  that operation's write facet. Absent on legacy stories (their `writes`/`requires` stand
   *  alone). */
  operation?: string;
  /** States this story presupposes — each must be produced by some write (precondition closure). */
  requires?: Precondition[];
};

/** A guard on a write facet — kind-tagged so the observatory renders it as a chip (CL8) and
 *  the generator lowers it to a `_`-private predicate (CL4). The kinds correspond to the proof
 *  rules CL1 found in `hello`: `state` (a state-transition precondition — the dominant complex
 *  shape, 4 of 7 complex writes), `exists` (a row must exist), `is_member` (the caller belongs
 *  to a group), `byOther` (separation of duties — this row's producer ≠ the caller). The set is
 *  the CL1-empirical starting point; CL3/CL4 refine it as lowering demands. Never free text. */
export type Guard =
  | { kind: "exists"; where: string }
  | { kind: "state"; entity: string; path: string; value: string }
  | { kind: "is_member"; of: string }
  | { kind: "byOther"; of: string };

/** The read facet of an operation — a projection the engine keeps live (today's `document`). */
export type ReadFacet = { node: DocNode };

/**
 * An executable write — a `StoryWrite` (so the predicates read `entity`/`op`/`path`/`to`
 * unchanged) widened with the delta op the generator applies (CL4). `deltaPath` is the
 * JSON-Pointer the op targets, `value` what it sets — both templated: a string `":name"`
 * resolves to a param, anything else is a literal. Omitting them lets a predicate-only
 * write (a legacy story write) stand as-is; the generator needs them to lower the effect.
 */
export type FacetWrite = StoryWrite & {
  /** Delta op path, params templated `:name` — e.g. `/membership/-`, `/invite/:invite_id/status`.
   *  Defaults to `/<entity-collection>/-` (add) when omitted. */
  deltaPath?: string;
  /** The delta op value (add / replace). An object/scalar; a string `":name"` resolves to the
   *  param `name`, a `{ field: ":name" }` object resolves per-field. Omitted for `remove`. */
  value?: unknown;
};

/** The write facet of an operation — guarded effects. */
export type WriteFacet = {
  /** Kind-tagged guards, proven by precondition + authorization-tier-2 closure and lowered to
   *  `_`-private predicates (CL4). Structured, never free text — the predicates and the
   *  generator both consume the structure. */
  preconditions: Guard[];
  /** The effect: a delta op list (backend-agnostic, applied + broadcast by `delta_apply`). */
  writes: FacetWrite[];
  /** The doc the writes apply to (the `delta_apply` target), templated `:name` — e.g.
   *  `my-account::user_id`. Omitted ⇒ the generator derives it from the actor's identity-scoped
   *  read facet (the one read op whose `where` binds the actor's `auth` param). */
  doc?: string;
};

/**
 * An operation — the unified primary (v2+). A named, actor-scoped, parameterised function
 * (the same `params` grammar as a document) carrying a **read** facet (a projection) and/or a
 * **write** facet (guarded effects). A pure-read operation *is* today's document; a pure-write
 * operation is what was called a *command*; an operation may carry both. The predicates apply
 * per facet (CL3); the channel follows the facet; the observatory draws both facets (CL8).
 */
export type Operation = {
  name: string;
  actor: string;
  params: Param[];
  /** Present when the operation PROJECTS/observes state — today's `document` shape. */
  read?: ReadFacet;
  /** Present when the operation EFFECTS state — guards + a delta op list. */
  write?: WriteFacet;
  /** A thin ack the `call` returns (e.g. a new id) — the real outcome is the broadcast. An
   *  operation that both effects AND returns a fresh projection carries `read` + `write` +
   *  `result` (the `both` facet CL1 found the live `hello` server already does, though the
   *  model couldn't yet express it). */
  result?: { type: string };
};

/**
 * An **action** — the document-first write noun (the imperative dual of a `Document`). Guards gate
 * it; `writes` are its structured effects on collections. It is NOT bound to one document —
 * subscription closure relates its writes to every document watching the collections it touches.
 * Lowered to an operation's write facet for the engine (see core/document-first.ts).
 */
export type Action = {
  name: string;
  actor: string;
  params: Param[];
  guards: Guard[];
  writes: FacetWrite[];
  doc?: string;
  result?: { type: string };
};

export type Model = {
  /** The grammar version this model targets. **Absent ⇒ v1** — the pre-versioning
   *  baseline, so every model.json written before schema versioning is implicitly v1
   *  and needs no edit. A monotonic integer; `hjeli migrate` walks an older model up the
   *  forward-only ladder (see core/migrations.ts) to CURRENT_SCHEMA_VERSION — applying each
   *  rung through the broadcast/apply path and re-auditing, never a silent reinterpretation
   *  (guardrail 9). New models stamp the current version on `init`. */
  schemaVersion?: number;
  actors: Actor[];
  entities: Entity[];
  /** Legacy read surface (v1). A document is a read-only operation; kept so pre-recast
   *  models load unchanged. The migration ladder (v1→v2) lifts these into
   *  `operations[].read`; new models use `operations`. `readFacets` unifies both. */
  documents: Document[];
  /** The unified primary (v2+): named, actor-scoped, parameterised functions with a `read`
   *  facet and/or a `write` facet. Optional for back-compat — absent on a v1 file, defaulted
   *  to `[]` by the EMPTY_MODEL merge on load. */
  operations?: Operation[];
  /** The document-first WRITE noun (the authoring surface). Present on a document-first file
   *  (alongside `documents`); the read path lowers `documents` + `actions` to `operations` for the
   *  engine (core/document-first.ts), so the predicates/generators are unchanged. Its presence is
   *  what marks a file document-first. */
  actions?: Action[];
  stories: Story[];
};

/** Structured references to the model nodes a gap implicates — drives the
 *  observatory's gap-dots and spatial lens. A referenced node may exist (a
 *  highlight target) or be missing (a ghost target); the consumer decides by
 *  checking the model. Purely additive — the engine's behaviour is unchanged. */
export interface GapRefs {
  entity?: string;
  doc?: string;
  actor?: string;
}

export type Gap = {
  predicate:
    | "reachability"
    | "subscription-closure"
    | "actor-closure"
    | "precondition-closure"
    | "referential-closure"
    | "authorization-closure";
  kind: string;
  where: string;
  detail?: string;
  refs?: GapRefs;
};

export const EMPTY_MODEL: Model = { actors: [], entities: [], documents: [], operations: [], stories: [] };

/** The empty DOCUMENT-FIRST model — the two-noun authoring shape (`documents` + `actions`, no
 *  `operations`). `init` writes this; `loadRaw` merges missing arrays from it for a document-first
 *  file so a mutation never reintroduces an `operations` array. */
export const EMPTY_DOC_MODEL: Model = { actors: [], entities: [], documents: [], actions: [], stories: [] };

/** The SEED for a doc that doesn't exist yet (the server-registered empty doc, and the local
 *  missing-file load). Carries BOTH write surfaces (`operations: []` AND `actions: []`) so the
 *  very first op can be either grammar's: `add /actions/-` (the document-first authoring verb)
 *  no longer dies with "Path not found at segment actions", and `init`'s `remove /operations`
 *  still has its key. `init` then strips `operations`, leaving a clean document-first file. */
export const SEED_MODEL: Model = { actors: [], entities: [], documents: [], operations: [], actions: [], stories: [] };

/**
 * The model's read facets as legacy `Document`s — the unified read set the predicates and the
 * generator range over. Sourced from BOTH the legacy `documents[]` (v1) AND each operation's
 * `read` facet (v2+), so a v1 model and the v2 model it migrates to present an IDENTICAL read
 * set (the documents→operations migration is lossless). Legacy documents first, then operation
 * read facets — but the generator sorts by name, so order never reaches a generated artefact.
 */
export function readFacets(model: Pick<Model, "documents" | "operations">): Document[] {
  const fromOps = (model.operations ?? [])
    .filter((o): o is Operation & { read: ReadFacet } => o.read !== undefined)
    .map((o) => ({ name: o.name, actor: o.actor, params: o.params, node: o.read.node }));
  return [...model.documents, ...fromOps];
}

/** Does `entity`'s FK ancestry carry any `owner` column? If not, the entity is global/public.
 *  The shared ownership probe — the predicate engine, the verdict classifier, and the generator
 *  all need "is this table owner-RLS'd" (it decides whether a read must bind identity / clear RLS,
 *  CL9). Lives in grammar so no consumer reaches into another's privates. */
export function hasOwnerInTree(model: Pick<Model, "entities">, entity: string, seen = new Set<string>()): boolean {
  if (seen.has(entity)) return false;
  seen.add(entity);
  const e = model.entities.find((x) => x.name === entity);
  if (!e) return false;
  if (e.fields.some((f) => f.owner)) return true;
  for (const f of e.fields) {
    const t = f.fk?.split(".")[0];
    if (t && hasOwnerInTree(model, t, seen)) return true;
  }
  return false;
}
