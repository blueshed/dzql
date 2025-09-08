# ZeroQL Test Cleanup Plan

## Current Issues

### 1. Inconsistent Cleanup Strategies
- **Problem**: Different test files use different cleanup approaches (beforeEach vs afterAll vs both)
- **Impact**: Tests can interfere with each other, leaving orphaned data

### 2. Hard-coded ID Conflicts  
- **Problem**: Multiple tests use overlapping ID ranges:
  - `permissions.test.js` uses IDs > 200
  - `notifications.test.js` uses IDs > 100  
  - `search.test.js` inserts user with ID = 1
- **Impact**: Tests can overwrite each other's data

### 3. Pattern Matching Issues
- **Problem**: Using `LIKE '%Test%'` patterns can miss data or catch unintended records
- **Impact**: Incomplete cleanup, test data pollution

### 4. Foreign Key Dependencies
- **Problem**: Not cleaning up in proper dependency order
- **Impact**: Foreign key constraint violations, failed cleanups

### 5. Race Conditions
- **Problem**: Multiple test files running concurrently can interfere
- **Impact**: Flaky test results, data corruption

## Proposed Solutions

### 1. Standardized Test Data Isolation

**Create unique namespaces per test file:**
```javascript
// Each test file gets its own ID range
const TEST_ID_RANGES = {
  'auth.test.js': [1000, 1099],
  'client.test.js': [1100, 1199], 
  'domain.test.js': [1200, 1299],
  'events.test.js': [1300, 1399],
  'notifications.test.js': [1400, 1499],
  'permissions.test.js': [1500, 1599],
  'search.test.js': [1600, 1699],
  'websocket.test.js': [1700, 1799]
};
```

### 2. Centralized Cleanup Utilities

**Create `tests/test-utils.js`:**
```javascript
export class TestDataManager {
  constructor(testName, idRange) {
    this.testName = testName;
    this.idRange = idRange;
    this.createdIds = {
      users: [],
      organisations: [],
      venues: [],
      // ... track all created records
    };
  }

  async cleanup() {
    // Clean in proper dependency order
    await this.cleanupInOrder([
      'allocations',
      'contractor_rights', 
      'packages',
      'sites',
      'venues',
      'acts_for',
      'organisations',
      'users'
    ]);
  }
}
```

### 3. Consistent Test Structure

**Standardize all test files:**
```javascript
import { TestDataManager } from './test-utils.js';

const testData = new TestDataManager('domain.test', [1200, 1299]);

beforeAll(async () => {
  await testData.cleanup(); // Clean start
});

afterAll(async () => {
  await testData.cleanup(); // Clean finish
});
```

### 4. Dependency-Aware Cleanup

**Clean tables in reverse dependency order:**
1. `allocations` (depends on packages, sites)
2. `contractor_rights` (depends on packages, organisations) 
3. `packages` (depends on venues, organisations)
4. `sites` (depends on venues)
5. `venues` (depends on organisations)
6. `acts_for` (depends on users, organisations)
7. `organisations`
8. `users`

### 5. Transaction-Based Test Isolation

**Use database transactions for complete isolation:**
```javascript
describe('Test Suite', () => {
  let transaction;
  
  beforeEach(async () => {
    transaction = await sql.begin();
  });
  
  afterEach(async () => {
    await transaction.rollback();
  });
});
```

## Implementation Priority

### Phase 1: Critical Fixes (Immediate)
1. Fix ID range conflicts in existing tests
2. Add proper dependency-ordered cleanup to `afterAll` hooks
3. Use unique timestamps/UUIDs instead of hard-coded IDs where possible

### Phase 2: Standardization (Next)
1. Create `TestDataManager` utility class
2. Refactor existing tests to use standardized cleanup
3. Add cleanup verification (ensure cleanup actually worked)

### Phase 3: Advanced Isolation (Future)
1. Implement transaction-based test isolation
2. Add parallel test safety
3. Create test data factories for consistent test setup

## Immediate Actions Needed

### Fix ID Conflicts
```sql
-- Update test files to use non-overlapping ranges:
-- permissions.test.js: 1500-1599  
-- notifications.test.js: 1400-1499
-- search.test.js: 1600-1699 (don't hardcode user ID 1)
```

### Add Missing Cleanup
```sql
-- Ensure all test files clean up ALL created data:
DELETE FROM contractor_rights WHERE package_id IN (...);
DELETE FROM allocations WHERE package_id IN (...);
-- etc.
```

### Verify Foreign Key Order
```sql  
-- Clean in this order to avoid constraint violations:
1. allocations (child)
2. contractor_rights (child) 
3. packages (child)
4. sites (child)
5. venues (parent)
6. acts_for (junction)
7. organisations (parent)
8. users (parent)
```

## Success Metrics

1. **Test Independence**: Each test can run in isolation without failures
2. **Clean Database**: No test data remains after test suite completion  
3. **No Conflicts**: Tests can run in parallel without interference
4. **Reliable Cleanup**: Cleanup never fails due to constraint violations
5. **Fast Execution**: Cleanup is efficient and doesn't slow down tests significantly

## Files to Modify

1. `tests/test-utils.js` (new) - Centralized cleanup utilities
2. `tests/auth.test.js` - Fix cleanup, use ID range 1000-1099
3. `tests/client.test.js` - Better cleanup, use ID range 1100-1199  
4. `tests/domain.test.js` - Consistent cleanup, use ID range 1200-1299
5. `tests/events.test.js` - Fix server conflicts, use ID range 1300-1399
6. `tests/notifications.test.js` - Fix ID range to 1400-1499
7. `tests/permissions.test.js` - Fix ID range to 1500-1599
8. `tests/search.test.js` - Don't hardcode user ID 1, use range 1600-1699
9. `tests/websocket.test.js` - Add proper cleanup, use ID range 1700-1799