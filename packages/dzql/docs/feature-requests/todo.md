# DZQL v2 Gap Analysis TODO

Gap analysis comparing v1 tests to v2 functionality. Updated 2024-12-17.

---

## High Priority - COMPLETED

### Soft Delete ✅
- [x] Add `softDelete` handling to `generateDeleteFunction()` in `src/cli/codegen/sql.ts`
  - Sets `deleted_at = now()` instead of `DELETE FROM` when entity has `softDelete: true`
- [x] Add `deleted_at IS NULL` filter to `generateSearchFunction()`
- [x] GET still retrieves deleted records (for audit purposes)
- [x] Add soft delete integration tests (3 tests)
- Reference: `tests/integration/features.test.ts` - "Soft Delete" describe block

### Field Defaults ✅
- [x] Add `fieldDefaults` handling to `generateSaveFunction()` INSERT branch in `src/cli/codegen/sql.ts`
  - `@user_id` → `p_user_id`
  - `@now` → `now()`
  - `@today` → `current_date`
  - Literal values → insert as-is
- [x] Only apply defaults on INSERT, not UPDATE (uses COALESCE)
- [x] Add field defaults integration tests (4 tests)
- Reference: `tests/integration/features.test.ts` - "Field Defaults" describe block

### Composite Primary Key Support ✅
- [x] Update `generateSaveFunction()` to handle multi-column PKs
  - Dynamic PK null check and EXISTS query
  - WHERE clause supports all PK fields
- [x] Update `generateDeleteFunction()` for composite PKs
- [x] Update `generateGetFunction()` for composite PKs
- [x] Events store composite PK as JSONB object
- [x] Proper type casting for date, boolean, numeric columns
- [x] Add composite PK integration tests (4 tests)
- Reference: `tests/integration/features.test.ts` - "Composite Primary Keys" describe block

---

## Medium Priority - V1 Features Not Ported

### Dashboard Collection (filter: TRUE)
- [ ] Add `filter: TRUE` handling to `generateSubscribableGetFunction()` in `src/cli/codegen/subscribable_sql.ts`
  - Fetch ALL rows regardless of FK relationship to root
- [ ] Add `filter: TRUE` handling to `affected_keys` function
  - Return `'{}'::jsonb` to notify ALL subscribers
- [ ] Add dashboard collection integration test
- Reference: `tests/integration/dashboard-collection.test.js` (v1)

### Null-Root Dashboard
- [ ] Support subscribables with no root entity parameter
  - `root.key: '@user_id'` or similar built-in
- [ ] Add null-root dashboard test
- Reference: `tests/integration/null-root-dashboard.test.js` (v1)

### Delete Subscription Resolution
- [ ] Verify `affected_keys` function receives full record data on DELETE
- [ ] Add integration test for DELETE event subscription routing
- Reference: `tests/integration/delete-subscription-resolution.test.js` (v1)

### Atomic Subscription Updates
- [ ] Add integration test for Pinia store `applyPatch` with real WebSocket events
- [ ] Verify schema inclusion in subscribe response
- Reference: `tests/integration/atomic-subscription-updates.test.js` (v1)

---

## Low Priority - COMPLETED

### Custom Functions Pass-through ✅
- [x] Parse `customFunctions` from domain definition in IR generator
- [x] Include custom function SQL in generated migrations
- [x] Add custom functions to manifest allowlist for runtime security
- [x] Add custom functions integration tests (4 tests)
- Reference: `tests/integration/features.test.ts` - "Custom Functions" describe block

### JavaScript Custom Functions ✅
- [x] Add JS function handler registry (`src/runtime/js_functions.ts`)
- [x] Update `handleRequest` to check for JS handlers (takes precedence over SQL)
- [x] JS functions receive context with `userId`, `params`, and `db.query()` access
- [x] Export `registerJsFunction` API from runtime
- [x] Add JavaScript custom function integration tests (5 tests)
- Reference: `tests/integration/features.test.ts` - "JavaScript Custom Functions" describe block

### Temporal Table Support
- [ ] Implement `temporal.validFrom` / `temporal.validTo` filtering
- [ ] Auto-filter to current validity period
- Schema already defined in `venues.js:acts_for.temporal`

### On-Delete Graph Rules
- [ ] Verify `onDelete` graph rules receive correct record data
- [ ] Test cascading deletes
- Reference: `tests/integration/on-delete-graph-rules.test.js` (v1)

---

## Integration Test Coverage

### Missing Integration Tests (port from v1)
- [ ] Security / SQL injection prevention (`security.test.js`)
- [ ] M2M runtime operations (`m2m-runtime.test.js`)
- [ ] Permissions enforcement (`permissions.test.js` - more comprehensive)
- [ ] Event validation (`event-validation.test.js`)
- [ ] Namespace/entity discovery (`namespace-cli.test.js`)
- [ ] Migration runner (`migrations.test.js`)

### Current V2 Integration Tests
- `tests/integration/db.test.ts` - CRUD, permissions, events, graph rules ✅
- `tests/integration/e2e.test.ts` - Compiler pipeline ✅
- `tests/integration/full_stack.test.ts` - Runtime + WebSocket + Pinia ✅
- `tests/integration/features.test.ts` - Search filters, deep paths, M2M, soft delete, field defaults, composite PK ✅

---

## Not Applicable to V2

### Interpreted Mode
- V1 had runtime `register_entity` + generic functions
- V2 is compile-only by design - no gap, intentional removal

---

## Feature Comparison Summary

| Feature | V1 | V2 | Status |
|---------|----|----|--------|
| Authentication | ✅ | ✅ | Done |
| CRUD Operations | ✅ | ✅ | Done |
| Permissions | ✅ | ✅ | Done |
| Graph Rules | ✅ | ✅ | Done |
| M2M Relationships | ✅ | ✅ | Done |
| Events | ✅ | ✅ | Done |
| Subscribables | ✅ | ✅ | Done |
| Security (allowlist) | ✅ | ✅ | Done |
| Search Operators | ✅ | ✅ | Done |
| Deep Permission Paths | ✅ | ✅ | Done |
| Pinia Stores | ❌ | ✅ | New in V2 |
| .env Support | ❌ | ✅ | New in V2 |
| Soft Delete | ✅ | ✅ | Done |
| Field Defaults | ✅ | ✅ | Done |
| Composite PK | ✅ | ✅ | Done |
| Custom Functions (SQL) | ✅ | ✅ | Done |
| Custom Functions (JS) | ✅ | ✅ | Done |
| Dashboard Collection | ✅ | ❌ | **TODO** |
| Null-Root Dashboard | ✅ | ❌ | **TODO** |
| Interpreted Mode | ✅ | ❌ | Removed |
