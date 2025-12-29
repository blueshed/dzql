# DZQL V2 Implementation Plan

This plan outlines the execution steps to deliver the compile-only DZQL V2 as specified in `docs/version-2/gemini.md`.

## Phase 1: The Compiler Infrastructure (Weeks 1-2)

**Goal:** Establish the build pipeline that turns JavaScript module entity definitions into a structured Intermediate Representation (IR).

1.  **Project Setup**
    *   Create `packages/compiler-v2`.
    *   **Adopt JavaScript Modules as Input:** Define the compiler input format as JavaScript modules (e.g., `entities/[entity].js`).
    *   Set up a file watcher for `dzql watch`.

2.  **Module Loader & Analyzer**
    *   Implement a module loader to `import` these JavaScript configuration files.
    *   Implement a **Static Analyzer** to:
        *   Validate schema references.
        *   Validate permission paths.
        *   Build the dependency graph for subscriptions.

3.  **Intermediate Representation (IR)**
    *   Define the JSON schema for the IR.
    *   Ensure the IR captures `subscribables` definition in detail (nesting structure, filters, path keys).

## Phase 2: SQL Code Generation (Weeks 3-4)

**Goal:** Generate the specialized PostgreSQL functions from the IR.

1.  **Core Framework Generation**
    *   Generate `000_dzql_core.sql` (migrations table, events table, base types).

2.  **Function Generator (`save_X`, `delete_X`)**
    *   Implement `save_[entity]` (Atomic Upsert + Partial Update logic).
    *   Implement `delete_[entity]` (Cascade Logic).
    *   **Crucial:** Inline permission checks.
    *   **Crucial:** Compile graph rules (Cascades, Reactors).
    *   **Crucial:** Implement Commit Batching (single `NOTIFY` per tx).

3.  **Read Function Generator (`get_X`, `search_X`)**
    *   Implement `get_[entity]` and `search_[entity]`.

4.  **Realtime Logic Generator**
    *   Generate `_affected_keys` functions for subscription dependency tracking.

## Phase 3: The Manifest & Runtime (Weeks 5-6)

**Goal:** Build the secure, dumb runtime that executes the compiled logic.

1.  **Manifest Generator**
    *   Emit `manifest.json`.

2.  **Runtime Server (Node/Bun)**
    *   Implement Manifest Loader & Request Router (Strict O(1) lookup).
    *   Implement **WebSocket Handler** (Auth, Subscriptions, Event Multicasting with Commit Batching).
    *   Implement **Async Reactors** (execute JS/TS functions on reactor events).

## Phase 4: Subscribable Store Generator (Week 7)

**Goal:** Deliver the "Smart Store" client experience that handles deep graph synchronization.

1.  **JavaScript SDK Core**
    *   Implement the `WebSocketManager`.
    *   Implement the **Global Broadcast Dispatcher** (routes events to `table_changed`).

2.  **Subscribable Store Generator (`codegen/subscribable_store.ts`)**
    *   **Path Mapping:** Implement a compiler pass that traverses the `subscribable` definition to build a map of `Table Name -> Document Path` (e.g., `allocations` -> `sites[].allocations[]`).
    *   **Patch Logic Generator:** Generate the `applyPatch` function within the store that uses this map to update nested arrays/objects efficiently.
    *   **Store Output:** Generate `stores/use[SubscribableName]Store.js` (e.g., `useVenueDetailStore`) which binds to the specific subscription parameter and handles the graph sync.

## Phase 5: Testing & Migration (Week 8)

**Goal:** Verify parity with V1 and enable upgrade.

1.  **V1 Test Suite Adaptation**
    *   Port the existing V1 tests (`tests/integration/*`) to run against the V2 runtime.
    *   **Target:** 100% pass rate.

2.  **New Compiler & Runtime Tests**
    *   Add compiler-specific tests for parsing, IR generation, and SQL/Manifest output.
    *   **Crucial:** Verify generated stores correctly patch deep graphs using unit tests (headless store tests).

3.  **Migration Tooling**
    *   Build `dzql v1-extract` and `dzql migrate`.

## Execution Order

We will begin immediately with **Phase 1: Project Setup & Module Loader**.
