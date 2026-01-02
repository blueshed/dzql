# Rights Package - DZQL Composite Key Test Suite

**Purpose**: Demonstrate and test DZQL's composite primary key support for complex event/venue/sponsorship rights management.

**Status**: ✅ Core functionality working, ⚠️ Test coverage incomplete (25%)

## Quick Start

```bash
cd packages/rights

# Start database
bun db:up

# Run tests
bun test

# View database
open http://localhost:8081  # Adminer: postgres:5433, user: dzql, pass: dzql
```

## What This Package Provides

### 1. Composite Primary Key Demo
Comprehensive domain model with **junction tables** using composite keys:
- `site_products(site_id, product_id)`
- `acts_for(user_id, org_id, valid_from)`
- `module_components(module_id, component_id)`
- And 7+ more junction tables

### 2. Real-World Domain Model
40-table schema for event/venue rights management:
- **Venues & Sites**: Physical locations with hierarchical areas
- **Products & Modules**: Advertising products and installation hardware
- **Occasions & Events**: Temporal scheduling with moments
- **Packages & Allocations**: Commercial rights and site allocations
- **Contractors & Teams**: Task management and inventory
- **Permissions**: Complex multi-hop temporal permission paths

### 3. DZQL Feature Testing
- Composite key CRUD operations (SAVE, GET, SEARCH, LOOKUP, DELETE)
- FK dereferencing with composite keys
- Graph rules with composite key entities
- Temporal relationships with valid_from/valid_to
- Complex permission paths (4-5 hop chains)

## Files

```
packages/rights/
├── README.md                    # This file
├── TEST_COVERAGE.md            # Detailed coverage analysis
├── database/
│   ├── compose.yml             # Docker PostgreSQL setup
│   └── init_db/
│       └── 009_rights.sql      # Complete domain schema (1324 lines)
├── tests/
│   └── basic.test.js           # End-to-end workflow test (418 lines)
└── package.json                # Scripts and dependencies
```

## Test Coverage

**See [TEST_COVERAGE.md](./TEST_COVERAGE.md) for detailed analysis.**

**Summary**:
- ✅ **10/40 entities tested** (organisations, venues, sites, products, site_products, occasions, events, moments, packages, allocations)
- ✅ **Composite keys working** (site_products fully tested)
- ✅ **Core workflow tested** (org → venue → site → product → occasion → package → allocation)
- ❌ **30/40 entities untested** (acts_for, modules, contractors, inventory, tasks, etc.)
- ❌ **No temporal query tests** (on_date parameter)
- ❌ **No permission denial tests**
- ❌ **No delete operation tests**

**Test Quality**: Good demonstration of DZQL capabilities, insufficient for production confidence.

## Database Schema

**40 tables across 7 domains**:

1. **Core** (6 tables): organisations, users, acts_for, venues, areas, sites
2. **Products** (4 tables): products, site_products, modules, components
3. **Inventory** (6 tables): module_items, product_items, module_components, site_modules, faces, face_products
4. **Events** (5 tables): occasions, events, moments, contractor_rights, promotion_rights
5. **Commercial** (7 tables): packages, campaigns, campaign_packages, package_proposals, allocations, sponsor_briefs, allocation_options
6. **Inventory Mgmt** (3 tables): sponsor_selections, inventory_allocations, performance
7. **Tasks** (9 tables): teams, team_members, work_windows, tasks, task_dependencies, task_resources, module_task_templates, task_template_dependencies, task_template_components

**Plus**: site_info

See `database/init_db/009_rights.sql` for full schema.

## Example Usage

### Create Organisation (triggers graph rule)
```javascript
const org = await db.api.save.organisations({
  name: "Stadium Corp"
}, userId);
// Graph rule automatically creates acts_for relationship
```

### Work with Composite Keys
```javascript
// Link product to site (composite key)
await db.api.save.site_products({
  site_id: 1,
  product_id: 2
}, userId);

// Retrieve with FK dereferencing
const sp = await db.api.get.site_products({
  site_id: 1,
  product_id: 2
}, userId);
// Returns: { site_id: 1, product_id: 2, site: "Main Site", product: "Banner" }
```

### Permission Paths
```javascript
// Only users who act_for the venue's org can create venues
const venue = await db.api.save.venues({
  org_id: orgId,
  name: "New Stadium"
}, userId);
// Permission: @org_id->acts_for[org_id=$]{active}.user_id
```

## What's Working

✅ **DZQL Core Features**:
- All 5 CRUD operations with composite keys
- FK dereferencing with label fields
- Graph rules execution
- Real-time events with composite PK structure
- Complex permission path resolution

✅ **Tests Pass**:
```
1 test suite, 60+ assertions
All operations (SAVE/GET/SEARCH/LOOKUP) working correctly
Events system generating proper composite key structures
```

## What's Missing

⚠️ **Critical Gaps** (see TEST_COVERAGE.md):
- Temporal query testing (acts_for with on_date)
- Permission denial validation
- Delete operation testing
- 75% of entities untested
- No error case testing

**For Production Use**: Need comprehensive test suite covering all entities, permissions, temporal queries, and error cases.

**For DZQL Development**: Current tests sufficient to validate composite key support.

## Use Cases

### 1. DZQL Development Reference
- Example of complex domain with composite keys
- Reference implementation of permission paths
- Test bed for DZQL features

### 2. Regression Testing
- Ensures composite key support doesn't break
- Validates graph rules with junction tables
- Tests FK dereferencing with composite keys

### 3. Documentation
- Real-world example of DZQL capabilities
- Shows how to structure complex domains
- Demonstrates permission path patterns

## Next Steps

**To Complete Test Coverage**:
1. Add acts_for temporal tests (P0)
2. Add permission denial tests (P0)
3. Add delete operation tests (P0)
4. Test remaining 30 entities (P1-P2)

**To Use in Production**:
1. Complete test coverage above
2. Add validation rules
3. Add business logic
4. Add UI/frontend
5. Performance testing

## Related Documentation

- **Test Coverage Analysis**: [TEST_COVERAGE.md](./TEST_COVERAGE.md)
- **TDD Workflow**: [../../docs/development/TDD_WORKFLOW.md](../../docs/development/TDD_WORKFLOW.md)
- **DZQL API Reference**: [../dzql/docs/reference/api.md](../dzql/docs/reference/api.md)
- **GitHub Actions CI**: [../../.github/workflows/ci.yml](../../.github/workflows/ci.yml)

## Contributing

To add tests:

```javascript
test("description of what you're testing", async () => {
  // Setup: Create test data
  const org = await db.api.save.organisations({name: "Test"}, userId);

  // Exercise: Perform operation
  const result = await db.api.save.someEntity({...}, userId);

  // Verify: Check results
  expect(result.someField).toBe(expectedValue);

  // Cleanup: Remove test data (if needed)
  await sql`DELETE FROM someEntity WHERE id = ${result.id}`;
});
```

Run tests: `bun test`

## License

Part of the DZQL framework.

---

**Last Updated**: 2025-11-12
**Status**: Composite key support ✅ Complete | Test coverage ⚠️ 25%
