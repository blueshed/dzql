# DZQL v0.2.1 Release Notes

**Release Date:** November 18, 2025  
**Type:** Patch Release (Bug Fixes & Testing)

---

## Overview

DZQL v0.2.1 is a maintenance release focused on bug fixes, improved testing infrastructure, and documentation organization. This release improves the stability of subscription permission checking and establishes a modern testing framework for core DZQL features.

---

## Bug Fixes

### Compiler: Fixed Subscription Permission Path Evaluation

**Problem:** Permission functions for subscribables with direct field references (`@owner_id`, `@author_id`) were failing because they didn't fetch the entity data before checking permissions.

**Solution:**
- Permission functions now correctly fetch entity data when evaluating direct field references
- Added proper table aliasing to entity queries
- Updated AST handling to support both `direct_field` and `field_ref` types

**Example:**
```sql
-- Before: Would fail
SELECT dzql.register_subscribable(
  'my_posts',
  jsonb_build_object(
    'subscribe', ARRAY['@author_id']  -- Direct field reference
  ),
  ...
);

-- After: Works correctly
-- Generated function now fetches post data first:
CREATE FUNCTION my_posts_can_subscribe(p_user_id INT, p_params JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  v_entity_data JSONB;
BEGIN
  -- Fetch the entity to evaluate @author_id
  SELECT to_jsonb(t.*) INTO v_entity_data
  FROM posts t
  WHERE t.id = (p_params->>'post_id')::int;
  
  -- Now can evaluate @author_id
  RETURN p_user_id = (v_entity_data->>'author_id')::int;
END;
$$;
```

**Impact:** Subscribables with direct field permission paths now work correctly.

---

## Testing Improvements

### Migrated to bun:test Framework

**Changes:**
- Migrated all tests from custom test runners to `bun:test`
- Moved subscription tests from standalone scripts to proper test suite
- Organized tests into logical directories:
  - `/tests/compiler/` - Compiler tests
  - `/tests/subscriptions/` - Subscription integration tests
  - `/tests/test-utils/` - Shared testing utilities

**Benefits:**
- Standard test framework (better IDE integration)
- Faster test execution
- Consistent test patterns across codebase
- Better error reporting

### New TestDatabase Utility

**Added:** `tests/test-utils/db.js` - Isolated test database manager

```javascript
import { TestDatabase } from '../test-utils/db.js';

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();  // Creates isolated DB, runs migrations
});

afterAll(async () => {
  await db.teardown();  // Cleans up test database
});

test('example', async () => {
  const result = await sql`SELECT 1 as value`;
  expect(result[0].value).toBe(1);
});
```

**Features:**
- Process-isolated databases (`dzql_test_12345`)
- Automatic migration application
- Clean setup/teardown
- Works in Docker, local, and CI environments

### Docker Compose Test Setup

**Added:** `tests/test-utils/compose.yml` - PostgreSQL 16 for local testing

```bash
cd packages/dzql/tests/test-utils
docker compose up -d  # Start PostgreSQL
cd ../..
bun test              # Run tests
```

### Postgres Package Migration

**Changed:** All tests now use `postgres` package instead of `pg`

**Benefits:**
- Better TypeScript support
- Modern async/await patterns
- Tagged template literals for queries
- Consistent with DZQL server code

---

## Documentation

### Improved Organization

**Changed:**
- Moved subscription docs to `packages/dzql/docs/` for npm publishing
- Documentation now ships with the npm package
- Users can access docs without cloning the repo

**File Locations:**
- `packages/dzql/docs/guides/subscriptions.md` - Subscription guide
- `packages/dzql/docs/getting-started/subscriptions-quick-start.md` - Quick start
- `packages/dzql/docs/reference/api.md` - API reference

### Release Notes Structure

**Added:** Separate release notes in `docs/releases/`
- `RELEASE_NOTES_v0.2.0.md` - Detailed v0.2.0 notes
- `RELEASE_NOTES_v0.2.1.md` - This document
- `CHANGELOG.md` - Concise version history

---

## CI/CD Improvements

### Simplified CI Workflow

**Changed:** GitHub Actions now test only DZQL core (not example apps)

**Before:**
- Ran tests for venues, blog, streaks examples
- Many tests failing due to outdated examples
- Confusion about what's tested

**After:**
- Only tests `packages/dzql/tests/`
- Tests the actual API promises
- Faster, more reliable CI

**Configuration:** `.github/workflows/ci.yml`
```yaml
- name: Test - DZQL Core
  run: |
    cd packages/dzql
    bun test
```

---

## Breaking Changes

**None.** This release is fully backwards compatible with v0.2.0.

---

## Migration Guide

### Updating from v0.2.0

```bash
# Update package
npm install dzql@0.2.1
# or
bun add dzql@0.2.1

# No database migrations required
# No code changes required
```

If you were using subscribables with direct field permission paths that weren't working, they will now work correctly without any changes to your code.

---

## Known Issues

None reported.

---

## What's Next?

### v0.2.2 (If Needed)
- Additional bug fixes based on user feedback

### v0.3.0 (Planned)
- Advanced search operators (ranges, arrays, full-text)
- Full graph rules compilation
- Migration tooling
- TypeScript client generation

See the [Roadmap](../architecture/ROADMAP.md) for details.

---

## Testing

All tests passing:
- ✅ Compiler tests (SQL validation, entity compilation)
- ✅ Subscription tests (integration, subscribables)
- ✅ TestDatabase utilities
- ✅ CI/CD pipeline

Run tests locally:
```bash
cd packages/dzql
bun test
```

---

## Credits

**Bug Fixes & Testing:** Claude Sonnet 4.5  
**Project:** DZQL  
**Maintainer:** Peter Bunyan

---

## Links

- [Full Changelog](CHANGELOG.md)
- [v0.2.0 Release Notes](RELEASE_NOTES_v0.2.0.md)
- [Documentation](../../packages/dzql/docs/README.md)
- [GitHub Repository](https://github.com/blueshed/dzql)
- [Issues](https://github.com/blueshed/dzql/issues)
