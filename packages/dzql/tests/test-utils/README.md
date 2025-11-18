# DZQL Test Utilities

Shared testing infrastructure for the DZQL package.

## Files

- **`db.js`** - `TestDatabase` class for managing test database lifecycle
- **`compose.yml`** - Docker Compose configuration for PostgreSQL 16
- **`TEST_DATABASE_DESIGN.md`** - Full design documentation (in parent directory)

## Quick Start

### 1. Start PostgreSQL

```bash
cd packages/dzql/tests/test-utils
docker compose up -d
```

### 2. Run Tests

```bash
cd packages/dzql
bun test
```

### 3. Stop PostgreSQL

```bash
cd packages/dzql/tests/test-utils
docker compose down
```

## Using TestDatabase in Tests

```javascript
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { TestDatabase } from '../test-utils/db.js';

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe('My Tests', () => {
  test('example test', async () => {
    const result = await sql`SELECT 1 as value`;
    expect(result[0].value).toBe(1);
  });
});
```

## Environment Variables

- **`TEST_DATABASE_URL`** - Override default database connection
  - Default (Docker/Local): `postgres://postgres:postgres@localhost:5432/dzql_test`
  - Claude Web: `postgres://postgres@localhost:5432/dzql_test` (no password)

## How It Works

1. **Isolated Databases** - Each test suite gets its own database using `process.pid`
   - Example: `dzql_test_12345`
   - Allows parallel test execution
   - No test interference

2. **Automatic Migrations** - All DZQL migrations (001-009) run automatically
   - Fresh schema every time
   - No manual setup required

3. **Clean Teardown** - Databases are dropped after tests complete
   - No leftover test data
   - Clean slate for next run

## For Claude Web Users

Claude Web has PostgreSQL 16 built-in. Start it with:

```bash
pg_ctlcluster 16 main start
```

Then set the environment variable (no password needed):

```bash
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/dzql_test
bun test
```

See `../../../../docs/development/CLAUDE-WEB.md` for complete setup instructions.
