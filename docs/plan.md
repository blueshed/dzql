# DZQL Enhancement Implementation Plan

## Phase 1: Custom Function Pass-through (1 day) ✅

- [x] Update entity parser to extract custom functions after register_entity()
- [x] Modify compiler to include custom functions section in output
- [x] Test custom function extraction and compilation
- [x] Verify multiple entities with custom functions work correctly

## Phase 2: Field Defaults (1-2 days) ✅

- [x] Add field_defaults column to dzql.entities schema (001_schema.sql)
- [x] Update register_entity() to accept 10th parameter (005_entities.sql)
- [x] Update entity parser to parse field_defaults parameter
- [x] Enhance generic_save() to apply field defaults on INSERT (003_operations.sql)
- [x] Update operation codegen to document field defaults
- [x] Test field defaults with @user_id, @now, @today variables
- [x] Test that explicit values override defaults
- [x] Test that UPDATE operations don't reapply defaults

## Phase 3: Many-to-Many Support (3-5 days) ✅

### Schema & Parser
- [x] Add many_to_many column to dzql.entities schema (001_schema.sql)
- [x] Update entity parser to parse M2M config from graph_rules
- [x] Add expand flag support (default: false)

### Save Operation - Junction Table Sync
- [x] Add junction table sync logic to generic_save() (003_operations.sql)
- [x] Handle DELETE removed relationships
- [x] Handle INSERT new relationships (with ON CONFLICT)
- [x] Test save with M2M IDs array (parser level)
- [x] Test update changes M2M relationships atomically (parser level)
- [x] Test empty array removes all relationships (parser level)
- [x] Test null/omitted field leaves relationships unchanged (parser level)

### Get/Search Operations - M2M Expansion
- [x] Always include ID arrays in get operation (003_operations.sql)
- [x] Conditionally expand full objects based on expand flag (get)
- [x] Test get operation includes tag_ids array (parser level)
- [x] Test get operation expands when expand: true (parser level)
- [x] Always include ID arrays in search operation (004_search.sql)
- [x] Conditionally expand full objects based on expand flag (search)

## Phase 4: Integration Testing & Documentation (2 days) ✅

- [x] Test all three features work together
- [x] Test M2M with actual database (packages/venues)
- [x] Extended brands model with tags M2M relationship
- [x] All 103 tests pass (10 new M2M tests + 93 existing)
- [x] Verified junction table sync works correctly
- [x] Verified M2M expansion in save/get/search operations
- [x] Verified backwards compatibility (no existing tests broken)
- [x] Moved unit tests to packages/dzql/tests/compiler/
- [x] Create docs/guides/field-defaults.md
- [x] Create docs/guides/custom-functions.md
- [x] Create docs/guides/many-to-many.md
- [x] Update docs/reference/api.md with new parameters and examples
- [ ] Update README.md with feature highlights (optional)

## Test Files

**Parser/Compiler Unit Tests** (packages/dzql/tests/compiler/):
- `custom-functions.test.js` - Custom function extraction ✅
- `field-defaults.test.js` - Field defaults parsing ✅
- `many-to-many.test.js` - M2M config parsing ✅

**Integration Tests** (packages/venues/tests/):
- `brands-tags-m2m.test.js` - Full M2M with live PostgreSQL ✅

## Test Results

**M2M Tests (packages/venues/tests/brands-tags-m2m.test.js):**
- ✅ Create brand without tags
- ✅ Create tags using DZQL API
- ✅ Create brand with tags (M2M) - single atomic save
- ✅ Get brand includes tag_ids array
- ✅ Update brand tags - add and remove
- ✅ Update brand tags - remove all with empty array
- ✅ Update brand without tag_ids field leaves tags unchanged
- ✅ Search brands includes tag_ids in results
- ✅ Junction table is properly synced
- ✅ Deleting brand cascades to junction table

**Full Test Suite:** 103 pass, 0 fail

## Notes

- All features are backwards compatible (opt-in)
- M2M expansion defaults to `false` for performance
- Field defaults only apply on INSERT, not UPDATE
- Custom functions are pass-through (no validation)
- M2M ID fields (e.g., tag_ids) are automatically excluded from INSERT/UPDATE
- Type casting (::int) handled for junction table queries

---

**Estimated Total:** 7-10 days
**Actual Time:** 1 day
**Current Status:** ✅ Complete and tested in production-like environment
