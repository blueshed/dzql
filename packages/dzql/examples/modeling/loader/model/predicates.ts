import {
  hasOwnerInTree,
  readFacets,
  type Actor,
  type DocNode,
  type Gap,
  type Model,
  type Param,
  type Precondition,
  type Story,
  type StoryWrite,
} from "./grammar";
import { parsePath, resolvePath, terminalOf } from "./paths";

function walkNodes(node: DocNode, visit: (n: DocNode) => void): void {
  visit(node);
  for (const f of node.fields) {
    if (f.kind !== "scalar") walkNodes(f.node, visit);
  }
}

/**
 * A write action — the unit the write-side closures (subscription / precondition /
 * authorization) range over. Unifies the two write sources so the predicates prove BOTH a
 * legacy story's `writes`/`requires` AND an operation's write facet (CL3). For a v1/legacy
 * model (writes on stories, no operation write facets) this yields exactly the stories, so the
 * closures are unchanged; an authored write-facet operation adds its effects to the same proof.
 * A write-facet `state` guard translates to a `requires` precondition (the same provability
 * rule a story `requires` gets) — and when the same facet ALSO carries a `byOther` guard on
 * that entity, the translated requires is marked `byOther`, so authorization closure tier 2
 * (separation of duties) is provable from the document-first grammar, not only legacy stories.
 * The remaining guard kinds (exists/is_member) are inherently complex — their lowering is
 * proven by the generator (CL4) and classified by `facetVerdicts`, not gated here.
 */
export type WriteAction = { actor: string; label: string; writes: StoryWrite[]; requires: Precondition[] };

export function writeActions(model: Model): WriteAction[] {
  // A story that delegates to an operation (`operation` set) contributes nothing of its own — its
  // effects live on that operation's write facet, surfaced via `fromOps` below. Counting both would
  // double-prove the same write. A non-delegating (legacy) story still stands on its own `writes`.
  // `writes`/`requires` default to [] so a hand-authored story missing the key reports gaps
  // instead of crashing every audit after the op persisted.
  const fromStories: WriteAction[] = model.stories
    .filter((s) => !s.operation)
    .map((s) => ({
      actor: s.actor,
      label: s.action,
      writes: s.writes ?? [],
      requires: s.requires ?? [],
    }));
  const fromOps: WriteAction[] = (model.operations ?? [])
    .filter((o) => o.write)
    .map((o) => {
      const byOtherEntities = new Set(
        o.write!.preconditions
          .filter((g): g is { kind: "byOther"; of: string } => g.kind === "byOther")
          .map((g) => g.of.split(".")[0] ?? ""),
      );
      return {
        actor: o.actor,
        label: o.name,
        writes: o.write!.writes,
        requires: o.write!.preconditions
          .filter((g): g is { kind: "state"; entity: string; path: string; value: string } => g.kind === "state")
          .map((g) => ({
            entity: g.entity,
            path: g.path,
            value: g.value,
            ...(byOtherEntities.has(g.entity) ? { byOther: true } : {}),
          })),
      };
    });
  return [...fromStories, ...fromOps];
}

function entitiesWatched(node: DocNode): Set<string> {
  const set = new Set<string>();
  walkNodes(node, (n) => set.add(n.from));
  return set;
}

export function reachability(model: Model): Gap[] {
  const watched = new Set<string>();
  for (const d of readFacets(model)) for (const e of entitiesWatched(d.node)) watched.add(e);

  const gaps: Gap[] = [];
  for (const e of model.entities) {
    if (!watched.has(e.name)) {
      gaps.push({
        predicate: "reachability",
        kind: "unwatched-entity",
        refs: { entity: e.name },
        where: e.name,
        detail: "no document watches this entity — it is dead weight in the schema",
      });
    }
  }
  return gaps;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop single-quoted SQL string literals (with `''` escaping) so an `Entity.field`
 *  that only appears *inside* a literal — e.g. a default like `'Guest.rsvp_status'` —
 *  isn't mistaken for a real column reference. Mistaking it would falsely mark a
 *  field-level write as "covered" by a watching document: a silently missed gap. */
function stripLiterals(where: string): string {
  return where.replace(/'(?:[^']|'')*'/g, "''");
}





/** Does this write list contain the actor's establishing write? Ranges over a WriteAction's
 *  writes — so an actor established by a document-first ACTION (its delegating story correctly
 *  carrying `writes: []`) counts exactly as a legacy inline story write does. */
function isEstablishingWrite(actor: Actor, writes: StoryWrite[]): boolean {
  if (!actor.established_by) return false;
  const { entity, field, op } = actor.established_by;
  return writes.some((w) => {
    if (w.entity !== entity) return false;
    if (op && w.op !== op) return false;
    if (field && w.path !== field) return false;
    return true;
  });
}

export function actorClosure(model: Model): Gap[] {
  const gaps: Gap[] = [];
  const actorByName = new Map(model.actors.map((a) => [a.name, a]));

  for (const story of model.stories) {
    if (!actorByName.has(story.actor)) {
      gaps.push({
        predicate: "actor-closure",
        kind: "unknown-story-actor",
        refs: { actor: story.actor },
        where: story.action,
        detail: `story actor "${story.actor}" is not declared`,
      });
    }
  }

  // CL3: a story's `operation` ref must resolve to a declared operation, and every `opens`
  // target must name a real read facet — the CL1 #1 hole, where a story could open a document
  // that does not exist (e.g. `hello`'s `VenuePackages`) and the model still audited green.
  const opNames = new Set((model.operations ?? []).map((o) => o.name));
  const readNames = new Set(readFacets(model).map((d) => d.name));
  for (const story of model.stories) {
    if (story.operation && !opNames.has(story.operation)) {
      gaps.push({
        predicate: "actor-closure",
        kind: "unknown-story-operation",
        refs: { doc: story.operation },
        where: story.action,
        detail: `story invokes operation "${story.operation}", which is not declared`,
      });
    }
    // A delegating story's own `writes` are dropped from every closure (writeActions sources a
    // delegating story's effects from the operation's write facet, not the story). If such a
    // story ALSO declares loose writes, they are silently unproven — surface it so the model
    // can't audit green while an unauthorized write hides in the story's intent. The recast
    // rule: a story that sets `operation` carries its writes ON that operation, not inline.
    if (story.operation && (story.writes ?? []).length > 0) {
      gaps.push({
        predicate: "actor-closure",
        kind: "shadowed-story-writes",
        refs: { doc: story.operation },
        where: story.action,
        detail: `story delegates to operation "${story.operation}" but still declares ${story.writes.length} inline write(s) — those are dropped from every closure (unproven); move them onto "${story.operation}"'s write facet`,
      });
    }
    // The same soundness hole for `requires`: writeActions sources a delegating story's effects
    // from the operation, so inline `requires` on it reach NO closure (precondition, tier-2
    // separation of duties). Surface it — the model must not audit green while a precondition
    // silently evaporates. Two remedies: express them as guards on the action (`state`, plus a
    // `byOther` guard for separation of duties); OR, when the action already carries the same
    // guard (the common case for requires left behind by a recast), drop the redundant requires.
    if (story.operation && (story.requires?.length ?? 0) > 0) {
      gaps.push({
        predicate: "actor-closure",
        kind: "shadowed-story-requires",
        refs: { doc: story.operation },
        where: story.action,
        detail: `story delegates to operation "${story.operation}" but still declares ${story.requires!.length} inline requires — they reach no closure (unproven); express them as guards on "${story.operation}" (kind "state", plus "byOther" for separation of duties), or drop them if "${story.operation}" already guards the same condition`,
      });
    }
    for (const open of story.opens ?? []) {
      if (!readNames.has(open)) {
        gaps.push({
          predicate: "actor-closure",
          kind: "unresolved-open",
          refs: { doc: open },
          where: story.action,
          detail: `story opens "${open}", which is not a declared read facet (document or read operation)`,
        });
      }
    }
  }

  for (const doc of readFacets(model)) {
    if (!actorByName.has(doc.actor)) {
      gaps.push({
        predicate: "actor-closure",
        kind: "unknown-doc-actor",
        refs: { doc: doc.name, actor: doc.actor },
        where: doc.name,
        detail: `document actor "${doc.actor}" is not declared`,
      });
    }
  }

  // Establishment ranges over ALL write actions — legacy inline story writes AND document-first
  // action writes — so an actor established by a `register` action (whose delegating story
  // correctly carries `writes: []`) is not falsely flagged unestablished.
  const allWriteActions = writeActions(model);

  for (const actor of model.actors) {
    // Reachable if the actor opens a read facet OR carries any operation (a pure-write actor observes
    // nothing but is legitimate). A legacy document counts (it is a read facet).
    const reachable =
      readFacets(model).some((d) => d.actor === actor.name) ||
      (model.operations ?? []).some((o) => o.actor === actor.name);
    if (!reachable) {
      gaps.push({
        predicate: "actor-closure",
        kind: "dead-actor",
        refs: { actor: actor.name },
        where: actor.name,
        detail: "no operation reads or writes for this actor — actor is unreachable",
      });
    }

    if (actor.established_by) {
      const established = allWriteActions.some((a) => isEstablishingWrite(actor, a.writes));
      if (!established) {
        const { entity, field } = actor.established_by;
        gaps.push({
          predicate: "actor-closure",
          kind: "unestablished-actor",
          refs: { actor: actor.name, entity },
          where: actor.name,
          detail: `no story or action writes ${entity}${field ? "." + field : ""} — no path for a person to become this actor`,
        });
      }
    }
  }

  return gaps;
}

/**
 * Precondition closure — the dynamic check the other three miss.
 *
 * reachability / subscription-closure / actor-closure are all *static*: they ask whether
 * the model's parts cross-reference each other. None of them ask whether the *state* a write
 * presupposes can actually arise. A story that does `replace Campaign.status -> accepted` and
 * presupposes the campaign was first `proposed` is incoherent if nothing ever produces
 * `proposed` — yet all three static predicates stay green.
 *
 * Two tiers, both pure functions of the model:
 *   1. row tier    — a `replace`/`remove` presupposes the row exists, so some story must `add` it.
 *   2. state tier  — every `requires` precondition must be *produced* by some write's `to` value
 *                    (an `add`/`replace` that sets `entity.path = value`).
 *
 * This generalizes `actor.established_by` (a person can become an actor only if some write
 * creates the establishing row) from actors-to-rows up to rows-to-states.
 */
export function preconditionClosure(model: Model): Gap[] {
  const gaps: Gap[] = [];

  const actions = writeActions(model);

  // Row tier: which entities does some write action bring into existence?
  const created = new Set<string>();
  for (const a of actions) for (const w of a.writes) if (w.op === "add") created.add(w.entity);

  for (const a of actions) {
    for (const w of a.writes) {
      if ((w.op === "replace" || w.op === "remove") && !created.has(w.entity)) {
        gaps.push({
          predicate: "precondition-closure",
          kind: "unestablished-row",
          refs: { entity: w.entity },
          where: `${a.actor}: ${a.label}`,
          detail: `${w.op} ${w.entity}${w.path ? "." + w.path : ""} presupposes a ${w.entity} row, but nothing adds one`,
        });
      }
    }
  }

  // State tier: which states does some write produce?
  const produced = new Set<string>();
  for (const a of actions)
    for (const w of a.writes)
      if (w.path && w.to !== undefined) produced.add(`${w.entity}.${w.path}=${w.to}`);

  for (const a of actions) {
    for (const req of a.requires) {
      const key = `${req.entity}.${req.path}=${req.value}`;
      if (!produced.has(key)) {
        gaps.push({
          predicate: "precondition-closure",
          kind: "unreachable-precondition",
          refs: { entity: req.entity },
          where: `${a.actor}: ${a.label}`,
          detail: `presupposes ${key}, but no write produces that state`,
        });
      }
    }
  }

  return gaps;
}

function enumVariants(type: string | undefined): Set<string> | null {
  const inner = type?.match(/^enum<(.+)>$/)?.[1];
  return inner ? new Set(inner.split("|")) : null;
}

/**
 * Referential closure — every name in the model resolves to a real declaration.
 *
 * The other four registers are set-containment *within* the model — they never check
 * that a reference points at something that exists. This is the register that "generation
 * is a test" makes explicit: you cannot emit `SELECT status FROM Permit` if Permit has no
 * `status` column, nor a `CHECK (status IN (…))` for a value outside the enum. So the same
 * checks that let `export ts` / `export sql` succeed are exactly the checks that prove the
 * model's cross-references resolve.
 *
 *   - every DocNode `from` names a declared entity                  → unknown-from
 *   - every scalar `source` names a field on its node's `from`      → unknown-source
 *   - every field `fk` resolves to a declared `Entity.field`        → unknown-fk-target
 *   - every enum value used in a write `to` / story `requires`      → unknown-enum-value
 *     names a declared variant of that field's `enum<…>` type
 */
/** SQL-emittable identifier — entity / field / param names flow into generated tables, columns
 *  and `p_<name>` SQL parameters unescaped-by-construction, so the predicate proves they're
 *  safe to emit ("generation is a test" includes *safe*, not just *resolvable*). */
const SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Model-level name — documents / actions / operations / actors also feed doc prefixes and
 *  generated function names, where kebab-case is conventional, so `-` is additionally allowed. */
const MODEL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function referentialClosure(model: Model): Gap[] {
  const gaps: Gap[] = [];
  const entityByName = new Map(model.entities.map((e) => [e.name, e]));

  // ---- name validity + uniqueness -------------------------------------------------------
  // Every emitted identifier must be a safe token: a name carrying a quote or whitespace
  // would break out of the generator's `"…"` quoting (a `"`-bearing owner column emitted a
  // policy that authorized everything). And duplicate names make every later reference
  // ambiguous (two operations with one name; colliding tables on export).
  const invalidName = (what: string, name: string, re: RegExp, refs: Gap["refs"]): void => {
    gaps.push({
      predicate: "referential-closure",
      kind: "invalid-name",
      refs,
      where: name,
      detail: `${what} "${name}" is not an emittable identifier — must match ${re.source}`,
    });
  };
  const dupCheck = (names: string[], what: string, refOf: (n: string) => Gap["refs"]): void => {
    const seen = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) {
        gaps.push({
          predicate: "referential-closure",
          kind: "duplicate-name",
          refs: refOf(n),
          where: n,
          detail: `${what} "${n}" is declared more than once — names must be unique`,
        });
      }
      seen.add(n);
    }
  };
  for (const e of model.entities) {
    if (!SQL_IDENT.test(e.name)) invalidName("entity", e.name, SQL_IDENT, { entity: e.name });
    for (const f of e.fields) {
      if (!SQL_IDENT.test(f.name)) invalidName(`field (on ${e.name})`, f.name, SQL_IDENT, { entity: e.name });
    }
  }
  for (const a of model.actors) {
    if (!MODEL_NAME.test(a.name)) invalidName("actor", a.name, MODEL_NAME, { actor: a.name });
  }
  const facets = readFacets(model);
  for (const d of facets) {
    if (!MODEL_NAME.test(d.name)) invalidName("document", d.name, MODEL_NAME, { doc: d.name });
    for (const p of d.params) if (!SQL_IDENT.test(p.name)) invalidName(`param (on ${d.name})`, p.name, SQL_IDENT, { doc: d.name });
  }
  const writeOps = (model.operations ?? []).filter((o) => o.write);
  for (const o of writeOps) {
    if (!MODEL_NAME.test(o.name)) invalidName("action", o.name, MODEL_NAME, { doc: o.name });
    for (const p of o.params) if (!SQL_IDENT.test(p.name)) invalidName(`param (on ${o.name})`, p.name, SQL_IDENT, { doc: o.name });
  }
  dupCheck(model.entities.map((e) => e.name), "entity", (n) => ({ entity: n }));
  dupCheck(model.actors.map((a) => a.name), "actor", (n) => ({ actor: n }));
  // A document and an action MAY share a name (that pair is the engine's both-facet operation,
  // exactly what `migrate` raises a read+write op to) — but two read facets, or two write
  // facets, with one name are irresolvable.
  dupCheck(facets.map((d) => d.name), "document (read facet)", (n) => ({ doc: n }));
  dupCheck(writeOps.map((o) => o.name), "action (write facet)", (n) => ({ doc: n }));

  for (const d of readFacets(model)) {
    walkNodes(d.node, (n) => {
      // `limit` is interpolated into generated SQL — anything but a non-negative integer is a
      // syntax error at best, an injection at worst. Arbitrary JSON can carry either.
      if (n.limit !== undefined && (typeof n.limit !== "number" || !Number.isInteger(n.limit) || n.limit < 0)) {
        gaps.push({
          predicate: "referential-closure",
          kind: "invalid-limit",
          refs: { doc: d.name, entity: n.from },
          where: d.name,
          detail: `limit ${JSON.stringify(n.limit)} on the ${n.from} node must be a non-negative integer`,
        });
      }
      const ent = entityByName.get(n.from);
      if (!ent) {
        gaps.push({
          predicate: "referential-closure",
          kind: "unknown-from",
          refs: { doc: d.name, entity: n.from },
          where: d.name,
          detail: `DocNode from "${n.from}" is not a declared entity`,
        });
        return;
      }
      const fields = new Set(ent.fields.map((f) => f.name));
      for (const f of n.fields) {
        if (f.kind === "scalar" && !fields.has(f.source)) {
          gaps.push({
            predicate: "referential-closure",
            kind: "unknown-source",
            refs: { doc: d.name, entity: n.from },
            where: d.name,
            detail: `scalar "${f.name}" reads ${n.from}.${f.source}, which is not a field of ${n.from}`,
          });
        }
      }
      // Every qualified `Entity.column` reference in a where/order must name a real field —
      // otherwise the clause can't be emitted, AND (worse) the phantom column could *satisfy*
      // subscription closure for an equally phantom write path, since both sides are string
      // matching over the same token.
      for (const [clauseKind, clause] of [["where", n.where], ["order", n.order]] as const) {
        if (!clause) continue;
        const stripped = stripLiterals(clause);
        for (const e of model.entities) {
          const re = new RegExp(`\\b${escapeRegex(e.name)}\\.(\\w+)\\b`, "g");
          for (const m of stripped.matchAll(re)) {
            const col = m[1]!;
            if (!e.fields.some((f) => f.name === col)) {
              gaps.push({
                predicate: "referential-closure",
                kind: "unknown-clause-column",
                refs: { doc: d.name, entity: e.name },
                where: d.name,
                detail: `${clauseKind} references ${e.name}.${col}, which is not a field of ${e.name}`,
              });
            }
          }
        }
      }
    });
  }

  for (const e of model.entities) {
    for (const f of e.fields) {
      if (!f.fk) continue;
      const [tEnt, tField] = f.fk.split(".");
      const target = entityByName.get(tEnt ?? "");
      if (!target || !target.fields.some((tf) => tf.name === tField)) {
        gaps.push({
          predicate: "referential-closure",
          kind: "unknown-fk-target",
          refs: { entity: e.name },
          where: `${e.name}.${f.name}`,
          detail: `fk → ${f.fk} does not resolve to a declared Entity.field`,
        });
      }
    }
  }

  const fieldType = (entity: string, path: string): string | undefined =>
    entityByName.get(entity)?.fields.find((f) => f.name === path)?.type;
  const isNullable = (entity: string, path: string): boolean =>
    entityByName.get(entity)?.fields.find((f) => f.name === path)?.nullable === true;
  const checkEnumValue = (entity: string, path: string, value: string, where: string) => {
    const variants = enumVariants(fieldType(entity, path));
    // "null" names the unset state of a NULLABLE enum — the same state a nullable date or scalar
    // may be guarded on — so a guard or a `to` of "null" is a state, not a variant, there.
    if (value === "null" && isNullable(entity, path)) return;
    if (variants && !variants.has(value)) {
      gaps.push({
        predicate: "referential-closure",
        kind: "unknown-enum-value",
        refs: { entity },
        where,
        detail: `${entity}.${path} = "${value}" is not a variant of ${fieldType(entity, path)}`,
      });
    }
  };
  // Range over writeActions, NOT model.stories — so the checks cover BOTH legacy inline story
  // writes AND operation/action write facets (the document-first grammar's writes were
  // previously never enum-checked: a bogus variant audited six-green).
  for (const a of writeActions(model)) {
    const where = `${a.actor}: ${a.label}`;
    for (const w of a.writes) {
      if (w.path && w.to !== undefined) checkEnumValue(w.entity, w.path, w.to, where);
      // A write's `path` must be a real field of its entity — the enum check above silently
      // no-ops on a phantom field, and the generator can't emit a column that doesn't exist.
      // (An unknown entity is already flagged unknown-write-entity below; don't double-report.)
      if (w.path) {
        const ent = entityByName.get(w.entity);
        if (ent && !ent.fields.some((f) => f.name === w.path)) {
          gaps.push({
            predicate: "referential-closure",
            kind: "unknown-write-path",
            refs: { entity: w.entity },
            where,
            detail: `${w.op} targets ${w.entity}.${w.path}, which is not a field of ${w.entity}`,
          });
        }
      }
    }
    for (const r of a.requires) checkEnumValue(r.entity, r.path, r.value, where);
  }

  // Ownership PATHS on owner fields must resolve every reference (entity/column/enum) —
  // the same proof a document `where` gets. A path the engine can't resolve can't be
  // lowered, so it is a referential gap, never a silently half-applied string.
  for (const e of model.entities) {
    for (const f of e.fields) {
      const srcs = typeof f.owner === "string" ? [f.owner] : Array.isArray(f.owner) ? f.owner.filter((p): p is string => typeof p === "string") : [];
      for (const src of srcs) {
        const at = `${e.name}.${f.name}`;
        try {
          for (const msg of resolvePath(model, parsePath(src)))
            gaps.push({ predicate: "referential-closure", kind: "unknown-path-ref", refs: { entity: e.name }, where: at, detail: msg });
        } catch (err) {
          gaps.push({ predicate: "referential-closure", kind: "unparseable-path", refs: { entity: e.name }, where: at, detail: (err as Error).message });
        }
      }
    }
  }

  // CL3: every write target (story or operation write facet) names a declared entity — a write
  // the generator can't resolve to a table is a referential gap, exactly as an unknown doc
  // `from` is. (A green model already satisfies this via subscription closure; this names it.)
  for (const a of writeActions(model)) {
    for (const w of a.writes) {
      if (!entityByName.has(w.entity)) {
        gaps.push({
          predicate: "referential-closure",
          kind: "unknown-write-entity",
          refs: { entity: w.entity },
          where: `${a.actor}: ${a.label}`,
          detail: `write targets "${w.entity}", which is not a declared entity`,
        });
      }
    }
  }

  // CL3: every operation/document CLIENT param must be bound — referenced as `:name` somewhere
  // in its facets — else it can't be lowered to a query/effect parameter. An `auth` param is
  // substrate-bound (from `ws.data`) and always satisfied. `model.documents` covers a legacy
  // (un-migrated) model; `model.operations` covers a v2 model (the two are disjoint in practice).
  const checkParams = (name: string, params: Param[], bodyText: string, docTemplate?: string): void => {
    for (const p of params) {
      if (p.source === "auth") continue;
      // The body scan skips `::casts` (SQL). The write-facet `doc` template is NOT SQL — its
      // documented form is `my-account::user_id` (doc prefix + `:param`), and the generator
      // resolves it with a plain `:name` scan — so it gets the generator's regex, not the
      // SQL lookbehind, keeping predicate and generator in agreement about `::`.
      const inBody = new RegExp(`(?<!:):${escapeRegex(p.name)}\\b`).test(bodyText);
      const inDoc = docTemplate !== undefined && new RegExp(`:${escapeRegex(p.name)}\\b`).test(docTemplate);
      if (!inBody && !inDoc) {
        gaps.push({
          predicate: "referential-closure",
          kind: "unbound-param",
          refs: { doc: name },
          where: name,
          detail: `client param :${p.name} is declared but bound nowhere in "${name}"'s facets`,
        });
      }
    }
  };
  for (const d of model.documents) checkParams(d.name, d.params, JSON.stringify(d.node));
  for (const o of model.operations ?? []) checkParams(o.name, o.params, JSON.stringify({ read: o.read, write: o.write }), o.write?.doc);

  // The converse: every `:name` a write TEMPLATES (in a deltaPath, a value, or the doc target) must be a
  // declared param of the action, or `:now`, the store's clock. An undeclared name used to pass the
  // audit silently and reach the generated handler as an unbound variable (or, as a literal, the text
  // `":now"`), so a stamp that was never a param was never caught.
  for (const o of model.operations ?? []) {
    if (!o.write) continue;
    const declared = new Set(o.params.map((p) => p.name));
    const seen = new Set<string>();
    const scan = (s: string | undefined) => {
      for (const m of (s ?? "").matchAll(/(?<![:\w]):(\w+)/g)) seen.add(m[1]!);
    };
    for (const w of o.write.writes) {
      scan(w.deltaPath);
      scan(typeof w.value === "string" ? w.value : w.value === undefined ? undefined : JSON.stringify(w.value));
    }
    scan(o.write.doc);
    for (const name of seen) {
      if (declared.has(name) || name === "now") continue;
      gaps.push({
        predicate: "referential-closure",
        kind: "unknown-param-ref",
        refs: { doc: o.name },
        where: o.name,
        detail: `write references :${name}, which is neither a declared param of "${o.name}" nor :now`,
      });
    }
  }

  // Operation write-facet guards must reference real columns/entities — so a typo'd guard is a
  // referential gap (caught here) rather than a silently-ignored or mis-lowered runtime check.
  for (const o of model.operations ?? []) {
    for (const g of o.write?.preconditions ?? []) {
      const ref = g.kind === "byOther" ? g.of : g.kind === "state" ? `${g.entity}.${g.path}` : null;
      if (ref) {
        const [ent, field] = ref.split(".");
        const e = entityByName.get(ent ?? "");
        if (!e || !e.fields.some((f) => f.name === field)) {
          gaps.push({ predicate: "referential-closure", kind: "unknown-guard-ref", refs: { entity: ent }, where: o.name, detail: `guard ${g.kind} references ${ref}, which is not a declared Entity.field` });
        }
      } else if (g.kind === "is_member" && !entityByName.has(g.of)) {
        gaps.push({ predicate: "referential-closure", kind: "unknown-guard-ref", refs: { entity: g.of }, where: o.name, detail: `is_member guard targets "${g.of}", which is not a declared entity` });
      }
    }
  }

  return gaps;
}

function fkTargetEntity(fk: string | undefined): string | undefined {
  return fk?.split(".")[0];
}

/**
 * Authorization closure — the safety register. The other five prove the model is
 * *complete*; this proves no write is *unauthorizable*. It is to RLS what
 * subscription closure is to the listener: it proves the model expressed enough
 * for the substrate to *scope* each write to the actor performing it.
 *
 *   Tier 1 — ownership reachability: every story write targets an entity the actor
 *     owns (an `owner` column whose fk target is the actor's identity entity, or an
 *     FK-ancestor that is owned), OR a global entity (no `owner` anywhere in its FK
 *     ancestry, open to any actor). Otherwise → unauthorized-write.
 *   Tier 2 — separation of duties: a `requires` marked `byOther` must be produced by
 *     a different actor than the one consuming it. Otherwise → self-authorized-transition.
 *
 * Dormant until `owner` / `byOther` appear — a model using neither passes trivially
 * (exactly like `to` / `requires` for precondition closure).
 */
export function authorizationClosure(model: Model): Gap[] {
  const gaps: Gap[] = [];
  const entityByName = new Map(model.entities.map((e) => [e.name, e]));
  const actorByName = new Map(model.actors.map((a) => [a.name, a]));

  const identityEntity = (actor: string): string | undefined =>
    actorByName.get(actor)?.established_by?.entity;

  // A grant/junction maps an actor (its `owner` fk's target) to a group (its
  // `grant` fk's target) — e.g. Membership(user_id owner→User, org_id grant→Organisation)
  // grants a User access to an Organisation. True when some junction grants
  // `idEntity` access to `group`.
  const groupGrantedTo = (group: string, idEntity: string): boolean =>
    model.entities.some(
      (j) =>
        j.fields.some((f) => f.grant && fkTargetEntity(f.fk) === group) &&
        j.fields.some((f) => f.owner && fkTargetEntity(f.fk) === idEntity),
    );

  // A bare-fk owner reaches the identity directly, or via a group it is granted.
  const fkReaches = (fk: string | undefined, idEntity: string): boolean => {
    const t = fkTargetEntity(fk);
    return t !== undefined && (t === idEntity || groupGrantedTo(t, idEntity));
  };
  // An ownership PATH reaches the identity iff its terminal column (on the terminal
  // entity) is an fk to the identity entity (or a group granted to it), or the terminal
  // entity *is* the identity. Walks the parsed path; an unparseable path reaches nothing
  // (referential closure already flags it).
  const pathReachesIdentity = (src: string, idEntity: string): boolean => {
    let term: { entity: string; column: string } | null;
    try {
      term = terminalOf(parsePath(src));
    } catch {
      return false;
    }
    if (!term) return false;
    // The terminal column is COMPILED to `<column> = app.user_id` (paths.ts), so the proof must
    // require it to actually CARRY the identity: the identity entity's own `id`, or an fk that
    // reaches the identity (directly or via a granted group). Merely terminating *on* the
    // identity entity is not enough — `->User[x=$].name` would audit green yet lower to
    // `"name" = app.user_id`, nonsense enforcement.
    if (term.entity === idEntity && term.column === "id") return true;
    const tf = entityByName.get(term.entity)?.fields.find((f) => f.name === term!.column);
    return fkReaches(tf?.fk, idEntity);
  };
  const ownerReaches = (f: { fk?: string; owner?: boolean | string | (string | boolean)[] }, idEntity: string): boolean => {
    if (typeof f.owner === "string") return pathReachesIdentity(f.owner, idEntity);
    if (Array.isArray(f.owner)) return f.owner.some((p) => (typeof p === "string" ? pathReachesIdentity(p, idEntity) : fkReaches(f.fk, idEntity)));
    return f.owner === true && fkReaches(f.fk, idEntity);
  };

  // Does `idEntity` own `entityName` — via an owner column on it (directly to the
  // actor's identity entity, a GROUP the actor is granted via a membership junction, or
  // a proven ownership PATH), or transitively via an FK to a parent it owns?
  const ownedBy = (entityName: string, idEntity: string | undefined, seen: Set<string>): boolean => {
    if (idEntity === undefined || seen.has(entityName)) return false;
    seen.add(entityName);
    const e = entityByName.get(entityName);
    if (!e) return false;
    if (e.fields.some((f) => f.owner && ownerReaches(f, idEntity))) return true;
    for (const f of e.fields) {
      const t = fkTargetEntity(f.fk);
      if (t && ownedBy(t, idEntity, seen)) return true;
    }
    return false;
  };

  // Per-model memo of the TOP-LEVEL queries (G3): many story-writes hit the same
  // (entity, idEntity), and FK-ancestry is the steepest-growing term. Each entry is
  // a complete answer computed with a fresh `seen`, so it's order-independent and
  // doesn't interact with the recursion's cycle guard. Caps work at O(entities×actors).
  const ownedMemo = new Map<string, boolean>();
  const ownedByCached = (entity: string, idEntity: string | undefined): boolean => {
    const k = `${entity}|${idEntity}`;
    let r = ownedMemo.get(k);
    if (r === undefined) ownedMemo.set(k, (r = ownedBy(entity, idEntity, new Set())));
    return r;
  };
  // `hasOwnerInTree` is the shared grammar probe (the verdict classifier and the generator use
  // the same one), memoized here — one definition, no drift.
  const ownerTreeMemo = new Map<string, boolean>();
  const hasOwnerCached = (entity: string): boolean => {
    let r = ownerTreeMemo.get(entity);
    if (r === undefined) ownerTreeMemo.set(entity, (r = hasOwnerInTree(model, entity)));
    return r;
  };

  const actions = writeActions(model);

  // Tier 1 — ownership reachability.
  for (const a of actions) {
    const idEntity = identityEntity(a.actor);
    for (const w of a.writes) {
      if (ownedByCached(w.entity, idEntity)) continue;
      if (!hasOwnerCached(w.entity)) continue;
      gaps.push({
        predicate: "authorization-closure",
        kind: "unauthorized-write",
        refs: { entity: w.entity, actor: a.actor },
        where: `${a.actor}: ${a.label}`,
        detail: `${w.op} ${w.entity}${w.path ? "." + w.path : ""} — "${a.actor}" has no ownership path to ${w.entity}`,
      });
    }
  }

  // Tier 2 — separation of duties.
  const producerActors = (entity: string, path: string, value: string): Set<string> => {
    const actors = new Set<string>();
    for (const a of actions)
      for (const w of a.writes)
        if (w.entity === entity && w.path === path && w.to === value) actors.add(a.actor);
    return actors;
  };
  for (const a of actions) {
    for (const r of a.requires) {
      if (!r.byOther) continue;
      const producers = producerActors(r.entity, r.path, r.value);
      if (producers.size > 0 && [...producers].every((x) => x === a.actor)) {
        gaps.push({
          predicate: "authorization-closure",
          kind: "self-authorized-transition",
          refs: { entity: r.entity, actor: a.actor },
          where: `${a.actor}: ${a.label}`,
          detail: `presupposes ${r.entity}.${r.path}=${r.value}, but only "${a.actor}" produces it — a separate actor must (separation of duties)`,
        });
      }
    }
  }

  return gaps;
}



