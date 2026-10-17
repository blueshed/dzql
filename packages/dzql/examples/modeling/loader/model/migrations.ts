/**
 * Model schema versioning + the forward-only migration ladder (CL10).
 *
 * A model declares the grammar version it targets via a top-level `schemaVersion`
 * (absent ⇒ v1 — the pre-versioning baseline). A grammar change ships as a *migration*:
 * a rung on a forward-only ladder that rewrites a v-model into a (v+1)-model by emitting
 * the SAME three delta ops the CLI uses (add / replace / remove), terminating by stamping
 * the new version. Because a migration is an ordinary ops batch, it is auditable, replayable,
 * broadcastable, and consistent with how every model is built — nothing hand-edits the file
 * (guardrail 9).
 *
 * Two consumers, deliberately split:
 *   - `migrateInMemory` — the READ path. `audit` / `dump` / `export` load an old file and
 *     climb it in memory so the predicates / codegen see the current grammar; the file on
 *     disk is left untouched, so old samples keep working with no edit.
 *   - `hjeli migrate <path>` — the WRITE path. Applies each rung through the normal
 *     broadcast/apply path (the observatory stays live), re-auditing after each, durably
 *     bumping the stored model.
 *
 * Mutating ops (`add`/`replace`/`remove`/`import`) deliberately do NOT migrate — they apply
 * to the model at the version it declares, so an edit never silently reinterprets an old file.
 *
 * Forward-only — down-migrations are out of scope. Generated artefacts carry no separate
 * version; they're re-`export`ed from the migrated model.
 */
import { applyOps, type DeltaOp } from "@blueshed/delta/core";
import type { Gap, Model } from "./grammar";
import { runAll } from "./predicates";

/** The version a model is at when it declares none — the pre-versioning baseline. */
export const BASELINE_VERSION = 1;

/** The grammar version this build of hjeli emits and proves. New models stamp it; `migrate`
 *  climbs older models up to it. Bumped by each grammar-changing clause (CL2 raised it to 2
 *  when `documents[]` generalised to `operations[]`). */
export const CURRENT_SCHEMA_VERSION = 2;

/** The version at which `operations[]` was introduced — used to INFER a model's version from its
 *  shape when it declares none. A file that already carries `operations[]` is v2-shaped even if it
 *  never stamped a version (hand-authored, or written by a tool that forgot to stamp), so reading
 *  it as v1 and re-running the v1→v2 lift would be wrong. "No version ⇒ look at the shape." */
export const OPERATIONS_VERSION = 2;

/** A rung on the ladder: given a model AT version `v`, return the delta ops that lift it to
 *  `v+1`. The batch MUST end by stamping the new version (`add`/`replace` `/schemaVersion`
 *  = `v+1`) — `migrationPlan` enforces this. Two kinds in practice (both just ops):
 *    - *mechanical* — a deterministic structural lift hjeli generates (e.g. a rename);
 *    - *needs-author* — lands the model green at the new version and lets the predicates
 *      demand the rest through the normal CLI loop (never guessed). */
export type Migration = (model: Model) => DeltaOp[];

/** The forward-only ladder, keyed by SOURCE version: `MIGRATIONS[v]` lifts v → v+1. */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2 (CL2): generalise `documents[]` → `operations[]`. A MECHANICAL lift — each
  // document becomes a read-only operation (its `node` under a `read` facet) and the legacy
  // array is emptied. The story→write-facet conversion is *needs-author* (a modelling
  // decision), handled incrementally through the normal CLI loop — NOT guessed here.
  1: (model) => [...liftDocumentOps(model), { op: "add", path: "/schemaVersion", value: 2 }],
};

/**
 * The `documents[]` → `operations[]` lift, as delta ops (NO version stamp). Each legacy document
 * becomes a read-only operation (`read.node`), SKIPPING any whose name already exists as an
 * operation, and the legacy array is emptied. The dedup is what makes the lift IDEMPOTENT: a
 * stale hybrid — documents lifted into operations but `documents[]` never cleared (a v2-stamped
 * file that the version-only ladder would never touch, since it only ever climbs UP) — folds
 * cleanly instead of re-creating duplicate operations. Returns `[]` when there is nothing to fold
 * (no documents), so callers can treat an empty result as "already normalised".
 *
 * Existing operations are preserved ahead of the lifted documents. The whole `operations` array
 * is rebuilt and `add`-ed (RFC 6902 `add` creates the member if absent), so the ops are
 * self-sufficient — they do not assume a merge has seeded `operations: []`.
 */
export function liftDocumentOps(model: Pick<Model, "documents" | "operations">): DeltaOp[] {
  if (!model.documents?.length) return [];
  const existing = new Set((model.operations ?? []).map((o) => o.name));
  const lifted = model.documents
    .filter((d) => !existing.has(d.name))
    .map((d) => ({ name: d.name, actor: d.actor, params: d.params, read: { node: d.node } }));
  return [
    { op: "add", path: "/operations", value: [...(model.operations ?? []), ...lifted] },
    { op: "replace", path: "/documents", value: [] },
  ];
}

/**
 * The version a model targets. A declared `schemaVersion` is authoritative. When ABSENT, infer
 * from the model's SHAPE rather than blindly assuming the baseline: a file already carrying
 * `operations[]` is v2-shaped (operations arrived at v2), so reading it as v1 — and re-running the
 * v1→v2 lift over it — would be wrong. A shapeless/documents-only file is the v1 baseline.
 * "No version ⇒ look at documents or operations," which is the whole point of versioning.
 */
export function modelVersion(model: Pick<Model, "schemaVersion" | "operations">): number {
  if (typeof model.schemaVersion === "number") return model.schemaVersion;
  return (model.operations?.length ?? 0) > 0 ? OPERATIONS_VERSION : BASELINE_VERSION;
}

export interface MigrationStep {
  from: number;
  to: number;
  /** the delta ops this rung applies (the last stamps `/schemaVersion` = `to`) */
  ops: DeltaOp[];
  /** predicate gaps in the model AFTER this rung applied — the per-step re-audit, so a rung
   *  that introduces gaps is localized to its step rather than blamed on the whole climb */
  gaps: Gap[];
}

export interface MigrationPlan {
  from: number;
  to: number;
  steps: MigrationStep[];
  /** the fully-migrated model, in memory (planning touches no file) */
  model: Model;
}

/**
 * Compute (don't persist) the chain that climbs `model` from its declared version up to
 * `target` (default CURRENT). Each rung runs against the running-applied model, so rung v+1
 * sees the result of rung v; each is re-audited (`runAll`) so a rung that introduces gaps is
 * localized to its step. Throws if a rung is missing (an unreachable version) or fails to
 * stamp the new version (a malformed migration). Pure: the passed-in model is deep-cloned, so
 * nothing the caller holds is mutated.
 */
export function migrationPlan(
  model: Model,
  opts: { target?: number; ladder?: Record<number, Migration> } = {},
): MigrationPlan {
  const ladder = opts.ladder ?? MIGRATIONS;
  const target = opts.target ?? CURRENT_SCHEMA_VERSION;
  const from = modelVersion(model);
  const steps: MigrationStep[] = [];
  const work = structuredClone(model);
  let v = from;
  while (v < target) {
    const rung = ladder[v];
    if (!rung) {
      throw new Error(
        `no migration registered for schemaVersion ${v} → ${v + 1} (target ${target})`,
      );
    }
    const ops = rung(work);
    applyOps(work, ops);
    if (modelVersion(work) !== v + 1) {
      throw new Error(
        `migration ${v} → ${v + 1} did not stamp schemaVersion ${v + 1} ` +
          `(model is at ${modelVersion(work)} after its ops) — every rung must end by ` +
          `stamping \`/schemaVersion\` = ${v + 1}`,
      );
    }
    steps.push({ from: v, to: v + 1, ops, gaps: runAll(work) });
    v += 1;
  }
  return { from, to: v, steps, model: work };
}

/**
 * The READ-path back-compat climb: return `model` migrated to `target` (default CURRENT) in
 * memory. A model already at/above target is returned UNCHANGED (same reference — no clone on
 * the hot path; forward-only, so a future-versioned file is left as-is). Used by `load` so
 * audit / dump / export interpret an old file under the current grammar without touching it
 * on disk. A no-op while CURRENT_SCHEMA_VERSION is the baseline.
 */
export function migrateInMemory(model: Model, target: number = CURRENT_SCHEMA_VERSION): Model {
  // Forward-only: a FUTURE-versioned file is left entirely as-is — even the shape-heal below,
  // which reasons under the current grammar, must not rewrite a model whose grammar this build
  // doesn't know (a future version may legitimately re-grow `documents[]`).
  if (modelVersion(model) > target) return model;
  // Climb the version ladder if below target (the up-migration path empties `documents[]`).
  const climbed = modelVersion(model) >= target ? model : migrationPlan(model, { target }).model;
  // Shape-heal: a model AT/above target may STILL carry a stale, un-emptied `documents[]` —
  // lifted into operations but never cleared. The version-only ladder never touches it (it only
  // climbs UP, and this model is already "at" its version), so it would render a phantom legacy
  // read surface forever. Fold it idempotently (dedup'd against existing operations) so the read
  // surface is always operations-only, whatever the stamped version claims. The climb path above
  // already empties `documents[]`, so this fires only on the at/above-target leftover case.
  const heal = liftDocumentOps(climbed);
  if (heal.length === 0) return climbed;
  const healed = structuredClone(climbed);
  applyOps(healed, heal);
  if (modelVersion(healed) < OPERATIONS_VERSION) healed.schemaVersion = OPERATIONS_VERSION;
  return healed;
}
