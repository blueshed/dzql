# DZQL v2 Codex (Compiled-Only) — Realtime Documents, Permissions, Atomic Deltas

## North Star

DZQL v2 is a **compiled realtime document engine** for PostgreSQL:

- You define **documents** (denormalized views of many tables) as first-class, named, parameterized contracts.
- You define **row-level permissions** (relationship/path based) as the authority for who can see what.
- The system delivers **atomic, transaction-scoped deltas** so clients can keep **large documents** up to date without re-fetching them.

CRUD exists, but only as a way to mutate the graph that feeds documents.

---

## What’s “bold” about v2

1. **Compiled-only, document-first**: subscriptions are the primary API; “live query rerun” is a fallback, not the core.
2. **Atomic delta stream as the default**: every write produces a commit; commits produce document patch ops.
3. **Permissions are part of patch computation**: patches are filtered by visibility; permission boundary changes emit explicit `reset`/`revoke`.
4. **Patchable document shape is standardized**: no positional array patching; collections are keyed.
5. **Runtime is not an interpreter**: it routes by a compiled manifest (function OIDs / allowlist), never by client-provided SQL identifiers.

---

## The v2 Object Model

### Entity (table-level building block)

Entities are tables with compiled operations and compiled permission predicates:

- `get/save/delete/search/lookup` (secondary)
- permission predicates for `view/create/update/delete`
- event emission hooks used by document deltas

### Subscribable (the primary abstraction)

A subscribable is a **parameterized document contract**:

- **Name**: `venue_detail`
- **Params schema**: `{ venue_id: int }`
- **Root**: a single root row or root set
- **Include graph**: relations and nested relations, each with keys and (optional) ordering
- **Scope tables**: the exact tables that can affect the document
- **Access control**:
  - `can_subscribe(user, params)`
  - row visibility rules for each included relation (what is allowed to be present inside the document)
- **Row visibility declarations:** per-include predicates compile to `dzql_v2.<s>_row_visible_<table>(user, params, row)`; compiler requires explicit predicates when filtering by permission inside the doc.
- **Delta rules**:
  - “which subscription keys are affected by this row change?”
  - “what patch ops does this change produce for this user + params?”

### Commit (atomic update unit)

All realtime updates are delivered as **commits**:

- `commit_id`: monotonic (DB-generated)
- `events[]`: normalized row events in that transaction (table/op/pk/old/new)
- `patches`: per-subscribable-per-subscription patch ops derived from those events

Clients apply patches in commit order; gaps trigger rebase.

---

## Compiled Callable Surface (what the runtime is allowed to call)

v2 is compiled-only, so the runtime must be able to route every operation to a known, allowlisted function.

### Entity operations (secondary, but still compiled)

For each entity `<e>` (a table), the compiler generates canonical functions (all in `dzql_v2`):

- `dzql_v2.get_<e>(p_user_id int, p_pk jsonb, p_on_date timestamptz default null) returns jsonb`
- `dzql_v2.save_<e>(p_user_id int, p_data jsonb, p_on_date timestamptz default null) returns jsonb`
- `dzql_v2.delete_<e>(p_user_id int, p_pk jsonb) returns jsonb`
- `dzql_v2.search_<e>(p_user_id int, p_query jsonb) returns jsonb`
- `dzql_v2.lookup_<e>(p_user_id int, p_query jsonb) returns jsonb`

Notes:

- `p_pk` is always `jsonb` (even for single-column PK) so routing never branches on schema shape.
- `p_data` can be a “document fragment” that includes nested writes; the compiler expands it into explicit SQL (no generic recursion loops).

### Subscribable operations (primary)

For each subscribable `<s>` (a document contract), the compiler generates:

- `dzql_v2.get_<s>(p_user_id int, p_params jsonb) returns jsonb` (snapshot)
- `dzql_v2.<s>_affected_keys(p_table text, p_op text, p_old jsonb, p_new jsonb) returns text[]` (returns `sub_key`s)
- `dzql_v2.<s>_patch_ops(p_user_id int, p_params jsonb, p_commit_id bigint) returns jsonb` (returns `{ commit_id, ops[], ... }`)

### Security posture of generated functions

- Functions that read/write application tables are `SECURITY DEFINER` with a locked `search_path` (compiler emits `SET search_path = dzql_v2, public;` explicitly).
- Runtime never passes SQL identifiers; it only supplies typed params (`jsonb`, `int`, `bigint`).
- Runtime methods map directly to full function names in a single namespace; no dotted verbs or dynamic identifier construction.

---

## Canonical Document Shape (arrays by default, keyed optional)

- **Default:** collections may remain arrays; row events + reset is the primary mode.
- **Optional keyed collections:** for docs that opt into patch mode, collections use `items` keyed by stable key (default PK) and optional `order` for deterministic ordering.
- **Ordering:** when ordering matters, declare a deterministic sort; if ordering becomes ambiguous on change, emit `reset`.

### Table → document path mapping (patchability)

Each included relation declares:

- collection path in the document
- item key field
- optional ordering rule (or `reset_on_order_change: true`)
- optional `delta_mode` override (`row_events` default, `patch` opt-in)

### Patch algebra (optional)

- **Default delta_mode:** `row_events` — emit row events and use `reset` on ambiguity; clients refetch snapshot on `reset`, tear down on `revoke`.
- **Optional delta_mode:** `patch` — emit `set/unset/upsert_item/remove_item/set_order` plus `reset/revoke` for keyed collections when explicitly enabled.
- The compiler may emit `reset` when a perfect delta is too expensive or ambiguous.

---

## Permissions v2 (row-level, relationship-based, delta-aware)

### What must always be true

For every user, for every subscribable document:

1. Subscription is only allowed if `can_subscribe(user, params)` is true.
2. Snapshot contains **only visible rows/fields**.
3. Patch ops reference **only visible rows/fields**.
4. When visibility changes due to a write, clients get an explicit signal:
   - `revoke` if subscription no longer allowed, or
   - `reset` if the document must be recomputed safely.

### Compiler outputs (permissions)

For each entity `<e>`:

- `dzql_v2.can_view_<e>(p_user_id int, p_row jsonb) returns boolean`
- `dzql_v2.can_create_<e>(p_user_id int, p_new jsonb) returns boolean`
- `dzql_v2.can_update_<e>(p_user_id int, p_old jsonb, p_new jsonb) returns boolean`
- `dzql_v2.can_delete_<e>(p_user_id int, p_row jsonb) returns boolean`

For each subscribable `<s>`:

- `dzql_v2.<s>_can_subscribe(p_user_id int, p_params jsonb) returns boolean`
- optional compiled predicates for included relations (so snapshot/deltas can filter rows):
  - `dzql_v2.<s>_row_visible_<table>(p_user_id int, p_params jsonb, p_row jsonb) returns boolean`

### Permission boundary handling (explicit, not implicit)

v2 defines three outcomes when an event affects visibility:

- **Patch**: safe to apply incrementally
- **Reset**: visibility or ordering changed in a way that requires recompute
- **Revoke**: user is no longer permitted to subscribe to this document key

This is the critical difference between “realtime” and “realtime + correct permissions”.

---

## Realtime Pipeline v2 (end-to-end)

### 1) Normalized row events (in DB)

All writes that can affect documents emit a normalized row event. Events are attached to a commit:

- `commit_id`, `table`, `op`, `pk`, `old`, `new`, `at`

This is emitted via triggers and written to a short-retention log table for:

- transaction batching
- debug/observability
- optional rebase support

**Commit correctness rule:** Postgres delivers `NOTIFY` only on commit, so the database can safely `pg_notify(...)` during the transaction and the runtime will only observe it after the transaction commits.

**One notify per commit:** v2 should avoid emitting one `NOTIFY` per row. A practical pattern:

- On first event in a transaction, allocate `commit_id` from a sequence and store it in `SET LOCAL dzql_v2.commit_id = '...'`.
- Insert every row event with that `commit_id`.
- Emit a single `pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text)` guarded by `SET LOCAL dzql_v2.commit_notified = '1'`.
- Runtime receives `{commit_id}` and fetches `events[]` by `commit_id` from `dzql_v2.events`.

### 2) “Which document keys are affected?” (compiled)

For each subscribable `<s>` the compiler generates `dzql_v2.<s>_affected_keys(...)` which returns **stable subscription keys** (`sub_key`), not raw params.

The compiler defines canonical keying:

- Normalize params as `jsonb` (stable key ordering) and compute `sub_key = sha256(<s> || ':' || params::text)`.
- Runtime stores subscriptions keyed by `sub_key` for O(1) matching.

### 3) “Row events → subscriber updates” (compiled, permission-aware)

Row events are the primary default. For each subscribable `<s>`, the compiler:

- generates `dzql_v2.<s>_affected_keys(...)` to identify impacted subscriptions
- in `row_events` mode (default), emits row events and may emit `reset/revoke` for permission/order ambiguity
- in `patch` mode (opt-in), generates `dzql_v2.<s>_patch_ops(...)` to emit patch algebra ops plus `reset/revoke`

### 4) Runtime fanout (boring by design)

Runtime responsibilities:

- maintain in-memory registry: `sub_key → [connection/subscription]`
- on commit notification:
  - fetch `events[]` by `commit_id`
  - determine which subscribables are in scope (manifest scope tables)
  - call `<s>_affected_keys(...)` for each relevant event
  - for each affected active subscription:
    - call `<s>_patch_ops(user_id, params, commit_id)`
    - emit patch to that connection

Runtime never:

- interpolates SQL identifiers from user input
- decides permissions
- guesses document structure

---

## Compiler v2 (document-centric IR)

### Canonical IR is subscribable-first

The compiler IR must represent:

- include graph with stable keys
- ordering rules (or explicit “reset on ordering ambiguity”)
- scope tables and dependency edges
- permission gates + row visibility rules
- mapping rules used by `patch_ops` (table → document path, item key field)
- param schema + canonical normalization rules
- **Source format:** default input is JavaScript modules (`import`-able) that export entity/subscribable configs (schema, relations, permissions, visibility predicates, mapping). Additional adapters (e.g., YAML) are optional, not required by v2.

Entities are still compiled, but documents drive the architecture.

### Compile-time validation (hard fails)

- Every collection must have a stable key.
- Any ordered collection must declare a deterministic sort key (or accept `reset` semantics).
- Permission paths must compile; missing relations/fields are errors.
- Subscribable params must be typed and normalizable (so hashing is stable).

---

## Database Core v2

### Schemas

- All DZQL objects in `dzql_v2`.
- Generated functions live in `dzql_v2` by default.

### Migrations (first-class)

Tracked migrations are mandatory:

- `dzql_v2.migrations(id text primary key, applied_at timestamptz, checksum text, name text)`

Compiler output installs as a migration unit (core → schema → generated functions → manifest).

### Manifest (the allowlist contract)

The manifest is the runtime’s routing table and the client’s schema contract:

- version and compatibility hash
- entities and operations (OIDs/names) in `dzql_v2`
- subscribables: params schema, snapshot function, affected-keys function, patch-ops function
- scope tables
- canonical document shape metadata (collection paths, key fields, ordering)
- validation rules (identifier-only method names; OIDs resolved at startup; fail-fast if any manifest entry missing in DB)

**Routing rule:** the runtime must be able to validate and route every incoming method without string interpolation:

- Map JSON-RPC method → manifest entry → function OID.
- Refuse any method not present in the manifest.
- Fail fast at startup if the database-installed manifest doesn’t match the runtime’s expected compatibility hash.

---

## Runtime v2 (shrunk + hardened)

Mandatory runtime features for the primary use case:

- strict message size limits (realtime + large docs makes this non-negotiable)
- rate limiting (per-connection and per-user)
- commit ordering + gap detection support
- clear error classification (permission denied vs validation vs internal)

### Error model (stable, non-leaky)

The runtime should translate database failures into stable categories (no raw SQL text in production):

- `PERMISSION_DENIED`
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL`

Optional:

- rebase endpoint: fetch fresh snapshot if client detects a gap

---

## Client v2 (minimal but opinionated)

The client library should provide:

- a canonical subscription store keyed by `sub_key`
- patch application engine for the v2 patch algebra
- gap detection and automatic rebase flow
- ergonomic helpers:
  - `subscribe('venue_detail', { venue_id })`
  - `unsubscribe(sub_id)`
  - `applyPatch(sub_id, commit)`

The client should not need to understand SQL, tables, or join graphs to stay in sync.

---

## Compatibility Mode (optional, for phased rollout)

If you need a lower-risk migration path, a subscribable can declare `delta_mode`:

- `row_events` (default for v2.0): emits atomic row events and uses `reset` aggressively when permission/filter/order ambiguity is detected.
- `patch` (future opt-in): emits the v2 patch algebra (`upsert_item`, `remove_item`, `set_order`, …) for keyed collections when explicitly enabled.

Client expectations:

- honor `commit_id` ordering; detect gaps and rebase
- apply `reset` by refetching snapshot; apply `revoke` by tearing down subscription
- when `delta_mode = row_events`, expect simpler behavior; this is the v2.0 default

This allows v2 to ship the compiled-only core (manifest routing + compiled permissions) while clients adopt patch semantics incrementally.

---

## Performance plan (for truly large documents)

v2 supports three escalating strategies:

1. **Pure patch stream (default)**: compute patches from row events; never re-send doc unless `reset`.
2. **Selective rebase**: snapshot is computed on demand; patches keep clients hot; resets are rare but supported.
3. **Optional document cache** (only when needed):
   - `dzql_v2.doc_cache(subscribable, sub_key, doc jsonb, cursor, updated_at)`
   - triggers maintain cache incrementally or by scheduled recompute
   - patch ops can be derived from cached fragments for expensive documents

The compiler can recommend when to enable caching based on join depth and expected fanout.

---

## Implementation Phases (aligned to the primary use case)

### Phase 1 — Contracts

- Canonical keyed-collection document shape
- Patch algebra + client apply semantics
- Commit/cursor model (ordering + gap detection)
- **Testing gate:** CI must cover manifest routing/OID resolution and reject unknown or malformed method names.
- **Testing gate:** CI must cover manifest routing/OID resolution and reject unknown or malformed method names.

### Phase 2 — Compiled subscribables (snapshot + deltas)

- Compiler IR for subscribables
- Generate:
  - `<s>_can_subscribe`
  - `<s>_get_snapshot`
  - `<s>_affected_keys`
  - `<s>_patch_ops`

### Phase 3 — Permission correctness (the hard part)

- Compile row visibility predicates usable by snapshot and patch functions
- Define and test boundary behaviors (`patch` vs `reset` vs `revoke`)
- Add “permission flip” test suite (relationship changes, role changes, temporal changes)
- **Testing gate:** permission flip cases must be automated (gain/lose visibility, reset/revoke emission).
- **Testing gate:** permission flip cases must be automated (gain/lose visibility, reset/revoke emission).

### Phase 4 — Runtime fanout + manifest-only routing

- Replace method-name interpolation with manifest allowlist/OIDs
- Subscription registry keyed by `sub_key`
- Commit batching and broadcast

### Phase 5 — Scale hardening

- Backpressure (drop to `reset` when patch cost is high)
- Optional doc cache mode
- Observability: patch sizes, reset/revoke rates, commit latency
- **Testing gate:** migrations must be idempotent and install the compiled `dzql_v2` surface; realtime pipeline must be covered end-to-end (commit batching → affected_keys → patch_ops/reset/revoke).
- **Testing gate:** migrations must be idempotent and install the compiled `dzql_v2` surface; realtime pipeline must be covered end-to-end (commit batching → affected_keys → patch_ops/reset/revoke).

---

## Open Questions (specifically for permissions + atomic deltas)

- Should permission flips always cause `reset`, or can we emit precise add/remove patches safely for some classes?
- Do we want a DB-backed active subscription registry for multi-node runtime fanout?
- How aggressively should the compiler attempt perfect deltas vs emitting `reset` for complex filter/order changes?

---

## V2 Principles (defaults and posture)

- **Compile-only, single namespace:** all callable functions live in `dzql_v2` with full names; no dotted verbs, no dynamic SQL.
- **Manifest/OID routing:** runtime loads manifest, resolves OIDs at startup, rejects any method not in the manifest; identifier-only validation on method names.
- **Row events first:** `delta_mode = row_events` is the v2.0 default; emit `reset/revoke` on ambiguity or permission changes. Patch/keyed mode is optional, future, and opt-in per subscribable.
- **Permissions baked in:** snapshot and deltas apply compiled predicates; permission flips produce `reset` or `revoke` explicitly.
- **Deterministic migrations:** tracked, idempotent migrations install `dzql_v2` core and generated functions; fail fast on mismatch.
- **Runtime is dumb:** single NOTIFY per commit, commit ordering/gap detection, size/rate limits; no client-provided identifiers or SQL text.
- **Input as code:** default source is importable JS modules for entities/subscribables; other adapters optional.
