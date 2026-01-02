# GEMINI_V2.md - DZQL Version 2 Specification

## The "Compile-Only" Mandate

**DZQL v2 is a ground-up rewrite that replaces the runtime interpreter with a static compiler and manifest-driven routing.**

The hybrid runtime/compiled model of v1 is deprecated. v2 is **strictly compile-only**. We no longer interpret rules or permissions at runtime. We compile them ahead of time into native PostgreSQL logic and generating a strict runtime manifest.

## Core Pillars

1.  **Compiler, Not Interpreter:** Business logic (permissions, graph rules, notifications) is compiled into specialized `plpgsql` functions. No generic execution engines.
2.  **Security by Construction:** The runtime **never** constructs SQL from user input. It loads a **Manifest** at startup and routes requests via allowlisted Function OIDs. **Crucially, client-supplied function names are strictly validated against this manifest for an exact match before any database interaction, preventing identifier injection.**
3.  **JavaScript Input Modules:** The compiler accepts **JavaScript Modules** (e.g., `venues-domain.js`) as the single source of truth. These modules define schema, permissions, relationships, and subscribables in a unified, type-safe format.
4.  **API Contract for AI:** The compiler generates a machine-readable **Manifest** that provides the canonical API contract. This manifest is crucial for AI assistance in generating accurate client-side code.
5.  **Graph Sync Stores:** The compiler generates **Smart Subscribable Stores** (e.g., `useVenueDetailStore`), NOT flat CRUD stores. These stores contain hard-coded logic to map atomic table updates (`allocations:insert`) into deep graph structures (`doc.sites[x].allocations.push(...)`), ensuring the UI graph stays perfectly in sync with the normalized database.
6.  **Pragmatic Realtime:** We prioritize correctness over complex patch algebras. We use standard row events, calculating "affected keys" efficiently, and falling back to "reset" (re-fetch) when permissions change.
7.  **First-Class Migrations:** We all agree that deterministic schema evolution is non-negotiable. The compiler output is treated as a tracked migration unit.
8.  **Async Reactors (Side Effects):** The runtime consumes atomic commit events to trigger external side effects safely and asynchronously.

## Architecture: The Compiler Pipeline

In v2, DZQL is fundamentally a **Compiler**.

### 1. Input: The Domain Module (`.js`)
A unified JavaScript module defining entities and subscribables. (See `venues-domain.js` for the canonical example).

```javascript
export const subscribables = {
  venue_detail: {
    root: { entity: 'venues', key: 'venue_id' },
    includes: {
      sites: { entity: 'sites', includes: { allocations: 'allocations' } }
    }
  }
};
```

### 2. The Compiler (Build Time)
The compiler performs analysis, optimization, and code generation.

*   **Phase 1: Module Loader & Analysis:** Imports the JS module, validates references against the schema, and builds the dependency graph.
*   **Phase 2: IR Generation:** Builds an Intermediate Representation of the entire domain.
*   **Phase 3: Code Gen:**
    *   **SQL:** Generates `dzql_v2.save_posts`, `dzql_v2.get_posts`, etc.
    *   **Manifest:** Generates `manifest.json` (routing table, types, scope definitions).
    *   **Client (Optional):** Generates `client.js` (JavaScript SDK).
    *   **Stores (Subscribable):** Generates specialized Pinia stores (`useVenueDetailStore.js`) containing the deep graph patching logic derived from the `subscribables` definition.

### 3. Output: The Artifacts
The build produces versioned migration files that are applied sequentially.

*   `migrations/000_dzql_core.sql`: The framework schema.
*   `migrations/<timestamp>_schema_v<hash>.sql`: Tables and types.
*   `migrations/<timestamp>_functions_v<hash>.sql`: The specialized logic.
*   `dist/runtime/manifest.json`: The brain of the runtime.
*   `dist/stores/useVenueDetailStore.js`: The smart client store.

## The Runtime (Server)

The v2 Server is a simplified, hardened **Postgres Gateway**.

*   **Startup:** Loads `manifest.json` into memory. Resolves full function names (e.g., `save_posts`) to PostgreSQL OIDs once. Checks migration status to ensure DB is in sync.
*   **Routing:** Client requests an operation like `save_posts`. The runtime uses an **in-memory O(1) hash map** to look up `save_posts` against the pre-loaded allowlist. If a match is found, it calls the *pre-resolved OID* for `dzql_v2.save_posts`.
*   **No Dynamic SQL:** The server contains *zero* code to generate SQL strings. It only executes prepared statements against known functions.
*   **Async Reactors:** The runtime subscribes to the internal `dzql_events` channel. When a commit batch arrives containing `reactor` events, the runtime looks up the corresponding JavaScript function (e.g., `reactors/send_welcome_email.js`) and executes it asynchronously.

## Feature Implementation

### 1. Realtime Row-Level Permissions (Compiled)

**v1 (Legacy):** Runtime parses JSON paths (`@org.members...`) for every request.
**v2 (Compiled):** Permission logic is inlined into the generated functions.

```sql
CREATE FUNCTION dzql_v2.save_posts(...) AS $$
BEGIN
  -- Compiled Permission Check
  IF NOT EXISTS (
    SELECT 1 FROM organisations o ... -- Standard SQL Joins
  ) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  -- ... Perform Update ...
END;
$$;
```

### 2. Atomic Updates & Graph Rules

**v1 (Legacy):** Generic recursion and runtime rule evaluation. Missing crucial cascade logic.
**v2 (Compiled):** The compiler generates a specific transaction plan for `save_posts`.

*   **Atomicity:** The root upsert, M2M relationship syncing, and side-effects (graph rules) happen in *one* hard-coded transaction block.
*   **Graph Rules:** Logic like "increment post count" is compiled into efficient SQL statements or triggers within the same transaction.
*   **Fulfilled Contract:** V2 must explicitly implement `CASCADE`, `SET NULL`, and `RESTRICT` behaviors for `on_delete` graph rules, which are defined in V1 tests (`tests/integration/graph-rules.test.js`) but unimplemented in the V1 runtime.

### 3. Subscriptions & Realtime (The Pragmatic Approach)

We align with the "Row Event + Reset" strategy (Claude's proposal) and the existing `applyAtomicUpdate` client-side patching mechanism, but enhanced with **Commit Batching**.

1.  **Commit Batching (New):** The database emits a **single NOTIFY per transaction** (commit). This notification contains a `commit_id`. The runtime then fetches all events associated with that `commit_id` from the `dzql_v2.events` table. This ensures atomic processing of related changes and reduces notification overhead.
2.  **Affected Keys (Compiled):** The compiler generates specific functions to determine *who* cares about an event batch.
    *   `dzql_v2.posts_affected_keys(op, old, new) -> ['post:123', 'feed:user:456']`
3.  **Runtime Fanout:** The runtime sees the event batch, calls the `_affected_keys` function for each event, and multicasts the messages to subscribed clients.
4.  **Permission Boundaries:** If a permission change implies a record might now be hidden (or revealed), the system emits a `reset` event, forcing the client to re-fetch the snapshot.
5.  **Global Broadcast Dispatcher:** The client SDK implements a global listener for all broadcast events. It iterates through all active Pinia stores and invokes a `table_changed(payload)` action if present.
6.  **Smart Subscribable Stores:** The generated store implements `table_changed` with **compiled path mapping**. It knows that an `update` to `allocations` maps to `doc.sites[site_id].allocations[id]`. This handles complex nesting without runtime guessing.

## Comparison: v1 vs v2

| Feature | v1 (Hybrid) | v2 (Compile-Only) |
| :--- | :--- | :--- |
| **Logic Location** | `dzql.entities` (JSON in DB) | **JavaScript Modules (`entities.js`)** |
| **Routing** | Dynamic SQL generation (Slow & Risky) | **O(1) In-Memory Manifest Lookup** (Fast & Secure) |
| **Permission Check** | Runtime Interpreter | **Inlined SQL Joins** |
| **Graph Rules** | Partial/Broken Runtime Support | **Full Compile-Time Support (Inc. Cascades)** |
| **Realtime Events** | 1 NOTIFY per row | **1 NOTIFY per Commit (Batched)** |
| **Side Effects** | N/A (or hacky triggers) | **Async Reactors (Node/Bun Functions)** |
| **Subscription Logic** | Runtime Guesswork | **Compiled Dependency Functions** |
| **Store Generation** | Flat/None | **Deep Graph Sync Stores** |
| **Migrations** | Numbered SQL (Manual) | **Compiler-Managed Migration Chain** |
| **API Method Call** | `verb.entity` (e.g., `save.posts`) | **`function_name`** (e.g., `save_posts`) |
| **Client Update** | Manual listeners / Reloads | **Global `table_changed` Dispatcher** |

## Test-Driven Validation

The existing V1 test suite (`tests/integration/permissions.test.js`, `atomic-subscription-updates.test.js`, etc.) serves as the **Acceptance Criteria** for V2.

*   **Parity:** All passing V1 tests must pass against the V2 runtime.
*   **Completion:** The currently *failing/unimplemented* tests in `tests/integration/graph-rules.test.js` (CASCADE/SET NULL) **must pass** in V2.

## Migration Strategy

1.  **Snapshot:** A tool extracts current v1 configuration into `.dzql` files.
2.  **Verify:** Developers review the generated source files.
3.  **Compile:** Run `dzql build` to generate the v2 SQL (as a migration) and Manifest.
4.  **Deploy:** Apply the migration. Point the new v2 Runtime at the DB.
5.  **Client Update:** Update frontend to use the generated v2 Client SDK.

## Summary

DZQL v2 combines the **performance and safety** of static compilation with the **correctness** of manifest-driven routing. It removes the entire class of "runtime interpretation" bugs and security issues, delivering a rock-solid foundation for realtime applications.