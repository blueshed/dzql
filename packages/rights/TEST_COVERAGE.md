# Rights Package - Test Coverage Analysis

**Generated**: 2025-11-12
**Test File**: `tests/basic.test.js` (418 lines)

## Executive Summary

- **Total Tables**: 40 tables
- **Registered Entities**: 41 entity registrations (some are junction tables)
- **Tested Entities**: 10 (25% coverage)
- **Test Focus**: Core workflow (org → venue → product → site → occasion → package → allocation)
- **Gap**: Missing tests for 30 entities (75% uncovered)

## Test Coverage by Entity

### ✅ COVERED (10 entities)

| Entity | SAVE | GET | SEARCH | LOOKUP | DELETE | Notes |
|--------|------|-----|--------|--------|--------|-------|
| **organisations** | ✓ | ✓ | - | - | - | Graph rule tested (creates acts_for) |
| **venues** | ✓ | - | - | - | - | Basic creation |
| **sites** | ✓ | - | - | - | - | Basic creation |
| **products** | ✓ | ✓ | ✓ | ✓ | - | Full CRUD tested |
| **site_products** | ✓ | ✓ | ✓ | ✓ | - | **Composite key** tested |
| **occasions** | ✓ | ✓ | ✓ | ✓ | - | Full CRUD tested |
| **events** | ✓ | ✓ | ✓ | ✓ | - | Full CRUD tested |
| **moments** | ✓ | - | ✓ | ✓ | - | Partial CRUD tested |
| **packages** | ✓ | ✓ | ✓ | ✓ | - | Full CRUD tested |
| **allocations** | ✓ | ✓ | ✓ | ✓ | - | Full CRUD tested |

**Coverage Quality**: Good - Tests demonstrate full workflow from organization creation to allocation.

**What's Tested**:
- Graph rule execution (org creation → auto acts_for)
- Composite primary keys (site_products)
- FK dereferencing (retrievedProduct.owner_org.name)
- Real-time events (linkEvent with composite PK structure)
- Complex workflows (multi-step operations)

### ❌ NOT COVERED (30 entities)

#### Critical Missing Coverage

**acts_for** (CRITICAL - temporal relationship)
- **Why Critical**: Core permission model - users act for organizations
- **What's Missing**: No tests for temporal queries, permission checks, membership management
- **Risk**: Permission system could break without detection

**contractor_rights** (temporal)
- **Why Critical**: Governs contractor access to venues
- **What's Missing**: Grant/revoke rights, temporal validity checks

**promotion_rights** (temporal)
- **Why Critical**: Delegates promotion rights from owner to promoter
- **What's Missing**: Delegation workflow, permission checks

#### Important Missing Coverage

**Physical Structure**:
- **modules** - Advertising modules/structures
- **module_components** - Parts list for modules
- **module_items** - Individual module inventory with barcodes
- **faces** - Surfaces on modules where ads go
- **face_products** - Which products fit on which faces
- **site_modules** - Module compatibility with sites
- **performance** - Performance scores (TV, social, footfall, hospitality)
- **site_info** - Contractor documentation of sites

**Inventory Management**:
- **components** - Hardware, tools, accessories
- **product_items** - Sponsor product inventory

**Commercial Operations**:
- **campaigns** - Sponsor marketing campaigns
- **campaign_packages** - Packages grouped in campaigns
- **package_proposals** - Proposals to potential sponsors
- **sponsor_briefs** - Sponsor priorities and assessments
- **allocation_options** - Contractor options for allocations
- **sponsor_selections** - Sponsor choices from options
- **inventory_allocations** - Specific item assignments

**Task Management**:
- **teams** - Contractor teams
- **team_members** - Team membership
- **work_windows** - Time windows for work
- **tasks** - Individual work tasks
- **task_dependencies** - Task ordering
- **task_resources** - Resources needed for tasks
- **module_task_templates** - Standard task templates
- **task_template_dependencies** - Template task ordering
- **task_template_components** - Components needed per template

**Other**:
- **areas** - Hierarchical areas within venues

## Test Coverage by Feature

### ✅ Well Tested Features

1. **Composite Primary Keys**
   - site_products(site_id, product_id) fully tested
   - Demonstrates: SAVE, GET, SEARCH, LOOKUP, DELETE with composite keys
   - FK dereferencing works correctly

2. **Graph Rules**
   - Organisation creation triggers acts_for creation
   - Verifies: graph rule execution, ownership establishment

3. **FK Dereferencing**
   - Tests confirm FK includes resolve correctly
   - Example: `retrievedProduct.owner_org.name`

4. **Real-time Events**
   - Composite PK structure in events verified
   - Event notification system working

5. **Basic Workflow**
   - Complete flow: org → venue → site → product → occasion → package → allocation

### ❌ Missing Feature Coverage

1. **Temporal Relationships** (CRITICAL GAP)
   - No tests for acts_for temporal queries
   - No tests with `on_date` parameter
   - No tests for valid_from/valid_to logic
   - No tests for temporal permission paths

2. **Permission System** (CRITICAL GAP)
   - No permission denial tests
   - No cross-org isolation tests
   - No tests for complex permission paths
   - No tests for multi-hop permissions

3. **Multi-Entity Workflows**
   - No contractor workflow tests
   - No sponsor selection workflow tests
   - No task management workflow tests
   - No inventory tracking tests

4. **Delete Operations**
   - No DELETE tests at all
   - No cascade delete tests
   - No soft delete tests (if implemented)

5. **Search & Filter**
   - Limited search filter testing
   - No complex filter operator tests
   - No pagination testing
   - No sort parameter testing

6. **Error Cases**
   - No permission denied tests
   - No validation error tests
   - No duplicate key tests
   - No foreign key violation tests

7. **Edge Cases**
   - No null value handling
   - No empty string handling
   - No boundary value testing
   - No concurrent operation tests

## Priority Recommendations

### P0 - Critical (Must Have)

1. **acts_for Temporal Tests**
   ```javascript
   // Test membership at different dates
   test("acts_for temporal queries with on_date", async () => {
     // User joins org on 2024-01-01
     await db.api.save.acts_for({
       user_id: userId,
       org_id: orgId,
       valid_from: "2024-01-01"
     });

     // Query as of 2023-12-31 (before membership)
     const venuesBefore = await db.api.search.venues({
       filters: { org_id: orgId },
       on_date: "2023-12-31"
     }, userId);
     expect(venuesBefore.data.length).toBe(0); // No access

     // Query as of 2024-01-02 (after membership)
     const venuesAfter = await db.api.search.venues({
       filters: { org_id: orgId },
       on_date: "2024-01-02"
     }, userId);
     expect(venuesAfter.data.length).toBeGreaterThan(0); // Has access
   });
   ```

2. **Permission Denial Tests**
   ```javascript
   test("user cannot access org they don't act for", async () => {
     // User 1 creates org
     const org = await db.api.save.organisations({name: "Org 1"}, user1Id);

     // User 2 tries to update org (should fail)
     await expect(async () => {
       await db.api.save.organisations({
         id: org.id,
         name: "Hacked"
       }, user2Id);
     }).toThrow(/Permission denied/);
   });
   ```

3. **Delete Operation Tests**
   ```javascript
   test("delete product", async () => {
     const product = await db.api.save.products({...}, userId);
     await db.api.delete.products({id: product.id}, userId);

     // Verify deleted
     await expect(async () => {
       await db.api.get.products({id: product.id}, userId);
     }).toThrow(/not found/);
   });
   ```

### P1 - High Priority (Should Have)

4. **Contractor Workflow Tests**
   - Test contractor_rights grant/revoke
   - Test contractor can access venue after rights granted
   - Test contractor cannot access after rights expire

5. **Module & Inventory Tests**
   - Test module creation with components
   - Test module_items barcode uniqueness
   - Test product_items inventory tracking

6. **Complex Search Tests**
   - Test all filter operators (gte, lte, like, ilike, between, etc.)
   - Test pagination (page, limit)
   - Test sorting (field, order)
   - Test _search text search

### P2 - Medium Priority (Nice to Have)

7. **Sponsor Workflow Tests**
   - Package proposal flow
   - Sponsor selection from options
   - Brief creation and assessment

8. **Task Management Tests**
   - Team creation and membership
   - Task creation with dependencies
   - Work window scheduling

9. **Performance Testing**
   - Large dataset queries
   - Concurrent user operations
   - Query performance benchmarks

### P3 - Low Priority (Future)

10. **Edge Case Tests**
    - Null/empty value handling
    - Boundary values
    - Unicode/special characters
    - SQL injection attempts

## Test Metrics

**Current**:
- Lines of test code: 418
- Test cases: 1 comprehensive end-to-end test
- Assertions: ~60 expect() calls
- Entities covered: 10/40 (25%)
- CRUD operations: ~27 operations tested

**Target** (for complete coverage):
- Lines of test code: ~2000-3000
- Test cases: 50-100 focused tests
- Assertions: ~300-500 expect() calls
- Entities covered: 40/40 (100%)
- All CRUD operations tested for critical entities

## How to Extend Tests

### Adding a New Test

```javascript
test("specific feature description", async () => {
  // Setup
  const org = await db.api.save.organisations({...}, userId);

  // Exercise
  const result = await db.api.save.someEntity({...}, userId);

  // Verify
  expect(result.id).toBeDefined();
  expect(result.someField).toBe(expectedValue);

  // Cleanup (if needed)
  await sql`DELETE FROM someEntity WHERE id = ${result.id}`;
});
```

### Running Specific Tests

```bash
# All rights tests
bun test packages/rights/tests/

# Specific test file
bun test packages/rights/tests/basic.test.js

# With database setup
cd packages/rights
bun db:up
bun test
```

## Test Data Isolation

**Current Approach**: Single comprehensive test that creates all data
**Issue**: If one step fails, subsequent steps don't run
**Recommendation**: Split into independent tests with proper beforeEach/afterEach cleanup

```javascript
beforeEach(async () => {
  // Create fresh test org and user for each test
  testOrg = await db.api.save.organisations({
    name: `Test Org ${Date.now()}`
  }, adminUserId);
});

afterEach(async () => {
  // Cleanup test data
  await sql`DELETE FROM organisations WHERE name LIKE 'Test Org %'`;
});
```

## Conclusion

The rights package has a **solid foundation** with good coverage of the core workflow, but significant gaps remain:

**Strengths**:
- ✅ Composite key support thoroughly tested
- ✅ Core workflow end-to-end tested
- ✅ Graph rules verified
- ✅ FK dereferencing working

**Critical Gaps**:
- ❌ Temporal relationship queries not tested
- ❌ Permission system not validated
- ❌ 75% of entities have no tests
- ❌ No delete operations tested
- ❌ No negative/error case testing

**Recommended Next Steps**:
1. Add acts_for temporal tests (P0)
2. Add permission denial tests (P0)
3. Add delete operation tests (P0)
4. Split comprehensive test into focused unit tests
5. Gradually add coverage for remaining entities

The test suite successfully **demonstrates** DZQL composite key support, but doesn't provide confidence that the full rights management system works correctly in production.
