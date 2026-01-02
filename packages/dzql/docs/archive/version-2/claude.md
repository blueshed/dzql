# DZQL v2 — Claude's Perspective (Revised)

## Convergence

Reading the updated Gemini and Codex proposals, I'm pleased to see significant alignment:

- **Gemini** explicitly adopts "Row Event + Reset" over patch algebras
- **Codex** adds a `delta_mode: row_events` compatibility path
- **All three** agree on: compiled-only, manifest routing, `dzql_v2` schema, security by construction

The core architectural decisions are settled. What remains is prioritization and a few technical choices.

---

## Where We Agree (The v2 Contract)

### 1. Compiled Functions in `dzql_v2`

All proposals converge on these signatures:

```sql
-- Entity operations
dzql_v2.get_<entity>(p_user_id int, p_pk jsonb) returns jsonb
dzql_v2.save_<entity>(p_user_id int, p_data jsonb) returns jsonb
dzql_v2.delete_<entity>(p_user_id int, p_pk jsonb) returns jsonb
dzql_v2.search_<entity>(p_user_id int, p_query jsonb) returns jsonb
dzql_v2.lookup_<entity>(p_user_id int, p_query jsonb) returns jsonb

-- Subscribable operations
dzql_v2.get_<sub>(p_user_id int, p_params jsonb) returns jsonb
dzql_v2.<sub>_affected_keys(p_table text, p_op text, p_old jsonb, p_new jsonb) returns text[]
```

Using `p_pk jsonb` universally (even for single-column PKs) is the right call — no runtime branching on schema shape.

### 2. Manifest-Driven Routing

The manifest is the allowlist. Runtime:
1. Loads manifest at startup
2. Resolves function OIDs
3. Refuses any method not in manifest
4. Fails fast on compatibility hash mismatch

No string interpolation of entity names. Ever.

### 3. Security by Construction

v2 uses a **flat namespace**. No more `save.venues` — just `save_venues`.

```
v1: ws.api.save.venues()  → nested proxy, verb + entity
v2: ws.api.save_venues()  → flat, single function name
```

The manifest is a simple allowlist:
```json
{ "functions": ["save_venues", "get_venues", "delete_venues", ...] }
```

**Validation:** Is `save_venues` in manifest? Yes → call `dzql_v2.save_venues()`. No → reject.

Functions are `SECURITY DEFINER` with locked `search_path`.

---

## Where I'd Push Back

### On Keyed Collections (Codex)

Codex proposes changing document shape from arrays to keyed objects:

```json
// Codex v2 proposal
{
  "sites": {
    "items": { "10": {...}, "11": {...} },
    "order": [10, 11]
  }
}
```

**My concern remains:** This breaks every existing client. The compatibility mode (`delta_mode: row_events`) helps, but now we're maintaining two document shapes forever.

**Counter-proposal:** Keep arrays. Handle ordering via `_order` field on records if needed. The patching problem is real, but the solution is `reset` on ambiguity, not a new document contract.

### On Migrations Infrastructure

~~Both Gemini and Codex include `dzql_v2.migrations`. I still think this is scope creep.~~

**Updated:** I was wrong. Migrations aren't just about tracking — they're **override points**. The compiler generates `register_user`, but you need to customize it for your auth flow. A numbered migration *after* the generated code lets you replace or extend it.

The pattern:
```
100_generated_entities.sql   -- compiler output
200_custom_overrides.sql     -- your register_user, _profile, etc.
```

This is already how v1 works. Keep it.

---

## What I'd Add

### 1. Explicit Error Categories

Codex mentions error sanitization but doesn't define the categories. Here's my proposal:

| Category | HTTP-ish | When |
|----------|----------|------|
| `PERMISSION_DENIED` | 403 | User lacks access |
| `NOT_FOUND` | 404 | Record doesn't exist |
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `CONFLICT` | 409 | Unique constraint, version conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL` | 500 | Unexpected error (hide details) |

The runtime maps SQLSTATE codes to these categories. Production never leaks SQL text.

### 2. Commit Batching (Codex's Good Idea)

Codex proposes batching row events per transaction:

```sql
-- On first event in transaction
SET LOCAL dzql_v2.commit_id = nextval('dzql_v2.commit_seq');

-- All events share this commit_id
INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, old, new, ...) VALUES (...);

-- Single NOTIFY at end
pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);
```

Runtime fetches all events by `commit_id` and processes atomically. This is cleaner than one NOTIFY per row.

### 3. Scope Tables in Manifest

For subscription efficiency, the manifest should declare which tables affect each subscribable:

```json
{
  "subscribables": {
    "venue_detail": {
      "scope_tables": ["venues", "sites", "acts_for"],
      "get_fn": "dzql_v2.get_venue_detail",
      "affected_fn": "dzql_v2.venue_detail_affected_keys"
    }
  }
}
```

Runtime skips `venue_detail_affected_keys` entirely if the event is from a table not in scope.

### 4. Subscription Key Hashing

Codex proposes `sub_key = sha256(subscribable_name + params)`. I'd simplify:

```javascript
sub_key = `${subscribable}:${JSON.stringify(sortKeys(params))}`
```

No hashing needed if params are small. Hash only if you need fixed-length keys for some reason.

---

## Phased Implementation (Revised)

Given convergence, here's what I'd prioritize:

### Phase 1: Security Foundation (Week 1-2)

- Manifest format and loader
- Manifest-based routing (OID resolution)
- Rate limiting skeleton
- Error categorization

Ship this as v2.0-alpha. The runtime is now secure even with v1 functions.

### Phase 2: Compiler MVP (Week 3-4)

- Parse `dzql.register_entity()` calls
- Emit `dzql_v2.get_*`, `save_*`, `delete_*` functions
- Emit manifest JSON
- Compile-time validation (column existence, path syntax)

Ship as v2.0-beta. People can test compiled functions.

### Phase 3: Subscriptions (Week 5-6)

- Subscribable definitions (scope tables, affected_keys)
- Commit batching
- `reset` on permission boundary changes
- Integration with v2 runtime

Ship as v2.0-rc.

### Phase 4: Polish (Week 7-8)

- Documentation
- Migration guide
- Performance benchmarks

Ship v2.0.0.

---

## Open Questions (Narrowed)

### 1. Permission Boundary Detection

When should we emit `reset` vs a precise delta?

**My position:** v2.0 uses `reset` conservatively. If any table in the permission path changes, reset. Precise deltas are a v2.x optimization.

### 2. Events: Just `data`

One field, not old/new:
- INSERT: `data` = new row
- UPDATE: `data` = new row (updated state)
- DELETE: `data` = deleted row (needed for subscription resolution)

**Edge case:** UPDATE changes `org_id` from 1 to 2. We only have new state (org_id=2).

**Solution:** `reset` for the ambiguous case. Don't bloat storage.

### 3. Input Format: JavaScript Modules (No Parsing)

v1 used `dzql.register_entity()` SQL calls — 10 positional parameters, nested JSON in strings. This was designed for the runtime interpreter.

**v2 drops the interpreter, so we drop that format.**

v2 uses JavaScript modules — no parsing required. Schema and config in one file:

```javascript
// entities/venues.js
export default {
  table: 'venues',

  // Schema — compiler generates CREATE TABLE
  schema: {
    id: 'serial PRIMARY KEY',
    name: 'text NOT NULL',
    address: 'text',
    org_id: 'int REFERENCES organisations(id)',
    created_at: 'timestamptz DEFAULT now()'
  },

  // DZQL config
  label: 'name',
  searchable: ['name', 'address'],
  includes: { org: 'organisations', sites: 'sites' },
  permissions: {
    view: [],
    create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
    update: ['@org_id->acts_for[org_id=$]{active}.user_id'],
    delete: ['@org_id->acts_for[org_id=$]{active}.user_id']
  },
  notifications: {
    ownership: ['@org_id->acts_for[org_id=$]{active}.user_id']
  },
  graphRules: {
    on_create: { /* ... */ }
  }
};
```

**Compiler generates:**
1. `CREATE TABLE venues (...)` from `schema`
2. `dzql_v2.save_venues()`, `get_venues()`, etc. from config

**Why JavaScript modules:**
- No parsing — just `import`
- Single file per entity (schema + config)
- Compiler validates searchable fields exist in schema
- Compiler validates FK includes match actual foreign keys
- Comments allowed
- IDE autocomplete works
- Familiar to anyone using Bun/Node

**Compiler invocation:**
```bash
dzql compile entities/*.js -o init_db/
```

**Output structure:**
```
init_db/
  100_schema.sql        # Compiler generates CREATE TABLE from entity.schema
  110_functions.sql     # Compiler generates save_*, get_*, delete_*, etc.
  200_custom.sql        # YOUR overrides: register_user, _profile, etc.
  210_seed.sql          # YOUR seed data
```

The compiler generates 1xx files. You own 2xx+ files for custom functions, overrides, and seeds. Compiler never touches your files.

---

## Updated Summary Table

| Feature | Gemini | Codex | Claude |
|---------|--------|-------|--------|
| Compiled functions | Yes | Yes | Yes |
| Manifest routing | Yes | Yes | Yes |
| `dzql_v2` schema | Yes | Yes | Yes |
| Row events + reset | Yes | Yes (compat mode) | Yes |
| Keyed collections | No | Yes (optional) | **No** |
| Commit batching | Implicit | Yes | **Yes** |
| Migrations / overrides | Yes | Yes | **Yes** (for custom overrides) |
| Error categories | Implicit | Mentioned | **Defined** |
| Input format | YAML DSL | Implicit | **JS modules** (no parsing) |
| Old/new in events | Implicit | Yes | **Yes** |

---

## TypeScript + tRPC

Since Bun runs TypeScript natively, v2 adopts TypeScript throughout:

**Entity definitions in TypeScript:**

```typescript
// entities/venues-domain.ts
import { defineEntity, defineSubscribable } from 'dzql';

export const venues = defineEntity({
  table: 'venues',
  schema: {
    id: 'serial PRIMARY KEY',
    org_id: 'int NOT NULL REFERENCES organisations(id)',
    name: 'text NOT NULL',
  },
  permissions: {
    view: [],
    create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
  },
  // TypeScript catches typos, IDE autocompletes
});
```

**tRPC for typed client-server communication:**

```typescript
// Client - fully typed, no code generation needed
const venue = await trpc.save_venues.mutate({
  name: 'New Venue',
  org_id: 1
});
// venue is typed: { id: number, name: string, org_id: number, ... }

// Subscriptions
trpc.venue_detail.subscribe({ venue_id: 1 }, {
  onData: (doc) => {
    // doc is fully typed
  }
});
```

**Compiler outputs:**

```bash
dzql compile entities/*.ts -o init_db/
```

Generates:
1. `100_schema.sql` — CREATE TABLE statements
2. `110_functions.sql` — dzql_v2.save_venues, etc.
3. `router.ts` — tRPC router with typed procedures
4. `types.ts` — Entity types inferred from schema

**Benefits:**

| Feature | Without | With TS + tRPC |
|---------|---------|----------------|
| Entity definition | JS, no validation | TS, type-checked |
| Client calls | Untyped | Fully typed |
| Subscriptions | Manual parsing | `trpc.X.subscribe()` typed |
| IDE support | Limited | Full autocomplete |
| Runtime validation | Manual | tRPC + zod built-in |

**tRPC subscription pattern:**

```typescript
// Server
export const appRouter = router({
  venue_detail: subscription({
    input: z.object({ venue_id: z.number() }),
    resolve: async function* ({ input, ctx }) {
      yield await getVenueDetail(ctx.userId, input.venue_id);
      for await (const event of subscribeToEvents(input.venue_id)) {
        yield event;
      }
    }
  })
});
```

This doesn't change the core architecture — just how clients talk to it. Type safety end-to-end reduces bugs.

---

## Test Coverage Requirement

**v2 requires 100% test coverage.**

The existing test suite validates the foundation:
- Compiler tests (parsing, code generation, permissions, graph rules, composite PKs)
- Security tests (SQL injection, permission bypass, password filtering)
- Integration tests (compiled CRUD, auth, subscriptions)

v2 must add tests for:
- Manifest generation and validation
- Manifest-based routing (allow/reject)
- `dzql_v2` schema namespace
- Subscribable compilation (`_affected_keys`, snapshots)
- Rate limiting
- Error categorization (SQLSTATE → category mapping)
- Commit batching (single NOTIFY per transaction)

No feature ships without tests. No exceptions.

---

## Final Thought

We're 90% aligned. The remaining 10% is mostly "when" not "if."

My recommendation: ship the security foundation first (manifest routing), then iterate. Don't block v2.0 on keyed collections.

The goal is a runtime that can't be tricked into executing arbitrary SQL. Everything else is enhancement.
