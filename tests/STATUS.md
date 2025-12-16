# Test Suite Status

## ✅ ALL TESTS PASSING: 313/313 (100%)

```bash
bun run test
```

Last verified: 2025-12-16

## Test Categories

| Category | Files | Description |
|----------|-------|-------------|
| **Core** | `tests/core/` | Compiler, parser, M2M, field defaults, graph rules |
| **Integration** | `tests/integration/` | Auth, CRUD, permissions, subscriptions, events |
| **Migrations** | `tests/migrations/` | Schema creation, idempotency |

## Running Tests

```bash
# Run all tests (starts Docker PostgreSQL automatically)
bun run test

# Run specific test file
bun run test -- tests/integration/auth.test.js
```

## Adding Tests

Follow patterns in existing tests:
- Use `setupTests()` from `tests/setup/test-helpers.js`
- Use `testEmail()` and `testName()` for unique test data
- Use `sql.json()` for JSONB parameters
- Clean up test data in `afterAll()`
