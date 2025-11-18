# DZQL v0.2.1 Release Notes

**Release Date**: 2025-11-18  
**Type**: Patch Release (Bug Fixes + Test Infrastructure)

## Bug Fixes

### Compiler: Fixed Permission Path Evaluation for Subscribables

**Issue**: Subscribables with direct field permission paths (e.g., `@owner_id`) were generating incorrect SQL that always returned `FALSE`, preventing authorized users from subscribing.

**Root Cause**:
- Parser returns AST type `direct_field` for `@owner_id`, but compiler only checked for `field_ref`
- Permission function tried to access `owner_id` from subscription parameters instead of fetching the entity
- Missing table alias in entity lookup query

**Fix**:
- Updated compiler to handle both `direct_field` and `field_ref` AST types
- Permission functions now fetch entity data when checking direct field references
- Added proper table alias to entity queries

**Example**:

Before (broken):
```sql
CREATE OR REPLACE FUNCTION test_can_subscribe(p_user_id INT, p_params JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (FALSE);  -- Always denied!
END;
```

After (fixed):
```sql
CREATE OR REPLACE FUNCTION test_can_subscribe(p_user_id INT, p_params JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  v_id int;
  entity RECORD;
BEGIN
  v_id := (p_params->>'id')::int;
  
  SELECT * INTO entity
  FROM test_entity root
  WHERE root.id = v_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  RETURN (entity.owner_id = p_user_id);
END;
```

**Affected Code**:
- `src/compiler/codegen/subscribable-codegen.js` - Lines 80-157

**Tests**: All 72 tests now passing (previously 2 were skipped due to this bug)

## Test Infrastructure Improvements

### Migrated to Proper `bun:test` Framework

Previously, subscription tests were ad-hoc executable scripts with `console.log` debugging. Now all tests use the proper `bun:test` framework with assertions.

**Changes**:
- Created `TestDatabase` class for automatic database lifecycle management
- Each test suite gets isolated database (`dzql_test_<process.pid>`)
- Automatic migration running (001-009)
- Works with Docker, Claude Web, and local PostgreSQL

**New Files**:
- `tests/test-utils/db.js` - TestDatabase class
- `tests/test-utils/compose.yml` - Docker Compose for PostgreSQL 16
- `tests/test-utils/README.md` - Complete testing documentation
- `bunfig.toml` - Bun test configuration

**Test Results**:
```
✓ 72 pass
✗ 0 fail
» 0 skip
⏱️  ~180ms
```

## File Organization

### Moved Files to Proper Locations

**Compiler CLI Tools** (moved to `src/compiler/cli/`):
- `compile-subscribable.js` - Main subscribable compiler
- `debug-subscribable-parser.js` - Parser debugger
- `debug-path-parser.js` - Path parser debugger
- `compile-example.js` - Example compiler
- `debug-compile.js` - Compilation debugger
- `debug-parse.js` - Parse debugger

**Removed Files**:
- `packages/dzql/compile-subscribable.js` - Moved to `src/compiler/cli/`
- `tests/subscriptions/test-subscription-basic.js` - Replaced by `subscribables.test.js`
- `tests/subscriptions/test-subscription-integration.js` - Replaced by `integration.test.js`
- `tests/subscriptions/test-subscription-e2e.js` - Deleted (needs server infrastructure)
- `tests/subscriptions/test-phase2-db.sh` - No longer needed
- `tests/subscriptions/test-subscription-e2e.sh` - No longer needed

### Fixed All Shebangs

All executable files now use `#!/usr/bin/env bun` (13 files updated)

## Documentation Updates

Updated all references to use:
- `bun` instead of `node`
- Correct file paths (`src/compiler/cli/` and `tests/subscriptions/`)

**Updated Files**:
- `packages/dzql/docs/SUBSCRIPTIONS_QUICK_START.md`
- `packages/dzql/docs/REFERENCE.md`
- `packages/dzql/docs/LIVE_QUERY_SUBSCRIPTIONS.md`
- `docs/RELEASE_NOTES_v0.2.0.md`
- `docs/TESTING_REPORT.md`
- `packages/dzql/README.md` - Added Testing section

## Breaking Changes

**None** - This is a patch release with backward-compatible bug fixes.

## Upgrading from 0.2.0

```bash
bun add dzql@0.2.1
# or
npm install dzql@0.2.1
```

No code changes required. If you were affected by the permission path bug, subscribables with `@field` patterns will now work correctly.

## Running Tests

```bash
# Start test database
cd packages/dzql/tests/test-utils
docker compose up -d

# Run tests
cd ../..
bun test

# Stop database
cd tests/test-utils
docker compose down
```

See `tests/test-utils/README.md` for complete testing documentation.

## Contributors

- Test infrastructure and compiler fixes by Claude (Anthropic AI Assistant)

## What's Next

- v0.2.2: Additional permission path patterns (traversals, filters)
- v0.3.0: E2E testing with live WebSocket server
- v1.0.0: Production-ready release with full test coverage

---

**Full Changelog**: https://github.com/blueshed/dzql/compare/v0.2.0...v0.2.1
