# DZQL Production Readiness - Detailed Execution Plan

**Created:** 2025-11-18
**Current Version:** 0.2.1
**Target:** 0.3.0 Alpha Release
**Total Estimated Time:** 6-8 weeks for full production readiness

---

## 🎯 Executive Summary

This plan prioritizes the **5 critical blockers** preventing production use, followed by medium-term improvements for scalability and developer experience. Each task includes:

- **Precise file locations** with line numbers
- **Implementation code samples**
- **Testing requirements**
- **Time estimates**
- **Success criteria**

---

## Phase 1: Critical Fixes (Week 1-2) - MUST DO BEFORE ANY RELEASE

### Priority Ranking
1. 🔴 **CRITICAL** - Compiler Bug (HIGH impact, LOW effort) - **4-6 hours**
2. 🔴 **CRITICAL** - Migration System (HIGH impact, MEDIUM effort) - **2-3 days**
3. 🔴 **CRITICAL** - Rate Limiting (HIGH impact, MEDIUM effort) - **1-2 days**
4. 🟡 **HIGH** - Error Handling (MEDIUM impact, MEDIUM effort) - **3-4 days**
5. 🟡 **HIGH** - Test Coverage (LOW impact, LOW effort) - **2-3 hours**

**Total Phase 1:** ~7-10 days

---

## Task 1: Fix Compiler Bug - Empty Graph Rules

**Priority:** 🔴 CRITICAL
**Effort:** 4-6 hours
**Impact:** HIGH - Blocks INSERT operations on entities without graph rules

### Problem
When `graph_rules: '{}'`, the compiler generates calls to `_graph_{entity}_on_create()` functions that don't exist, causing runtime errors.

**Documented in:** `/Users/peterb/Workshop/blueshed/dzql/bug.md`

### Files to Modify

#### 1. `packages/dzql/src/compiler/codegen/operation-codegen.js`

**Current behavior (BROKEN):**
```javascript
// Line ~150-170 (estimated, need to verify exact location)
// Always generates graph function calls
if (v_is_insert) {
  PERFORM _graph_${entity}_on_create(p_user_id, to_jsonb(v_result));
}
```

**Fix - Option 1 (RECOMMENDED):** Conditional generation
```javascript
// packages/dzql/src/compiler/codegen/operation-codegen.js

function generateSaveFunction(entity, config) {
  // ... existing code ...

  // NEW: Check if graph rules exist before generating calls
  const hasCreateRules = config.graph_rules?.on_create &&
    Object.keys(config.graph_rules.on_create).length > 0;

  const hasUpdateRules = config.graph_rules?.on_update &&
    Object.keys(config.graph_rules.on_update).length > 0;

  let sql = `
    CREATE OR REPLACE FUNCTION save_${entity.table_name}(
      p_user_id INT,
      p_data JSONB
    ) RETURNS JSONB AS $$
    DECLARE
      v_is_insert BOOLEAN;
      v_result RECORD;
    BEGIN
      -- ... existing save logic ...

      -- Graph rules execution (only if rules exist)
      ${hasCreateRules ? `
      IF v_is_insert THEN
        PERFORM _graph_${entity.table_name}_on_create(p_user_id, to_jsonb(v_result));
      END IF;
      ` : '-- No on_create graph rules defined'}

      ${hasUpdateRules ? `
      IF NOT v_is_insert THEN
        PERFORM _graph_${entity.table_name}_on_update(p_user_id, to_jsonb(v_result));
      END IF;
      ` : '-- No on_update graph rules defined'}

      RETURN to_jsonb(v_result);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  return sql;
}
```

#### 2. `packages/dzql/src/compiler/codegen/graph-rules-codegen.js`

**Verify this file only generates functions when rules exist:**

```javascript
// packages/dzql/src/compiler/codegen/graph-rules-codegen.js

export function generateGraphRuleFunctions(entity, config) {
  const functions = [];

  // Only generate if on_create rules exist
  if (config.graph_rules?.on_create && Object.keys(config.graph_rules.on_create).length > 0) {
    functions.push(generateOnCreateFunction(entity, config.graph_rules.on_create));
  }

  // Only generate if on_update rules exist
  if (config.graph_rules?.on_update && Object.keys(config.graph_rules.on_update).length > 0) {
    functions.push(generateOnUpdateFunction(entity, config.graph_rules.on_update));
  }

  // Only generate if on_delete rules exist
  if (config.graph_rules?.on_delete && Object.keys(config.graph_rules.on_delete).length > 0) {
    functions.push(generateOnDeleteFunction(entity, config.graph_rules.on_delete));
  }

  return functions.join('\n\n');
}
```

### Testing Requirements

#### 1. Create test file: `packages/dzql/tests/compiler/empty-graph-rules.test.js`

```javascript
import { test, expect } from "bun:test";
import { DZQLCompiler } from "dzql/compiler";

test("compiler should not generate graph function calls when graph_rules is empty", async () => {
  const sql = `
    SELECT dzql.register_entity(
      'test_events',
      'title',
      ARRAY['title'],
      '{}',
      false,
      '{}',
      '{}',
      '{"view": [], "create": []}',
      '{}'  -- Empty graph_rules
    );
  `;

  const compiler = new DZQLCompiler();
  const result = await compiler.compile(sql);

  // Should not contain graph function calls
  expect(result).not.toContain('_graph_test_events_on_create');
  expect(result).not.toContain('_graph_test_events_on_update');
  expect(result).not.toContain('_graph_test_events_on_delete');

  // Should contain save function
  expect(result).toContain('CREATE OR REPLACE FUNCTION save_test_events');
});

test("compiler should generate graph function calls when graph_rules exist", async () => {
  const sql = `
    SELECT dzql.register_entity(
      'test_orgs',
      'name',
      ARRAY['name'],
      '{}',
      false,
      '{}',
      '{}',
      '{"view": [], "create": []}',
      '{"on_create": {"establish_ownership": {"actions": [{"type": "create", "entity": "acts_for", "data": {"user_id": "@user_id", "org_id": "@id"}}]}}}'
    );
  `;

  const compiler = new DZQLCompiler();
  const result = await compiler.compile(sql);

  // Should contain graph function definition
  expect(result).toContain('CREATE OR REPLACE FUNCTION _graph_test_orgs_on_create');

  // Should contain graph function call in save function
  expect(result).toContain('PERFORM _graph_test_orgs_on_create');
});
```

#### 2. Run integration test

```bash
cd packages/dzql
bun test tests/compiler/empty-graph-rules.test.js
```

### Success Criteria
- ✅ Entities with `graph_rules: '{}'` compile without errors
- ✅ Generated `save_` functions don't call non-existent graph functions
- ✅ Entities WITH graph rules still generate functions correctly
- ✅ All existing tests still pass
- ✅ Can INSERT records into entities with empty graph_rules

### Deployment Steps
1. Fix `operation-codegen.js` and `graph-rules-codegen.js`
2. Run test suite
3. Recompile all example entities (venues, rights, streaks)
4. Test INSERT operations on compiled entities
5. Update CHANGELOG.md with fix
6. Commit: `fix: skip graph function calls when graph_rules is empty`

---

## Task 2: Implement Migration Tracking System

**Priority:** 🔴 CRITICAL
**Effort:** 2-3 days
**Impact:** HIGH - Required for production deployments

### Problem
SQL migration files (001-009) run on every Docker restart. No tracking of applied migrations. **Production deployments will fail.**

### Solution Architecture

#### Migration Tracking Table

**File:** `packages/dzql/src/database/migrations/000_migrations.sql` (NEW)

```sql
-- Migration tracking system
-- This file must run first (000_)

CREATE SCHEMA IF NOT EXISTS dzql;

CREATE TABLE IF NOT EXISTS dzql.migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,  -- SHA-256 of file content
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  execution_time_ms INT,
  success BOOLEAN DEFAULT true
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_migrations_applied_at
  ON dzql.migrations(applied_at DESC);

COMMENT ON TABLE dzql.migrations IS
  'Tracks which migrations have been applied to prevent re-running';
```

#### Migration Runner

**File:** `packages/dzql/src/database/migration-runner.js` (NEW)

```javascript
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Calculates SHA-256 checksum of migration file content
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Parses migration filename into version and name
 * Example: "001_schema.sql" -> {version: "001", name: "schema"}
 */
function parseMigrationFilename(filename) {
  const match = filename.match(/^(\d+[a-z]?)_(.+)\.sql$/);
  if (!match) return null;

  return {
    version: match[1],
    name: match[2],
    filename
  };
}

/**
 * Runs migrations that haven't been applied yet
 * @param {Object} sql - postgres connection
 * @param {Object} options - {migrationsPath, logger}
 */
export async function runMigrations(sql, options = {}) {
  const {
    migrationsPath = join(__dirname, 'migrations'),
    logger = console
  } = options;

  logger.info('🔄 Running database migrations...');

  try {
    // Ensure migrations table exists (run 000_migrations.sql first)
    const migrationTableFile = join(migrationsPath, '000_migrations.sql');
    const migrationTableSQL = await readFile(migrationTableFile, 'utf-8');
    await sql.unsafe(migrationTableSQL);

    // Get list of migration files
    const files = await readdir(migrationsPath);
    const migrations = files
      .map(parseMigrationFilename)
      .filter(Boolean)
      .filter(m => m.version !== '000') // Skip migrations table file
      .sort((a, b) => a.version.localeCompare(b.version));

    // Get already-applied migrations
    const applied = await sql`
      SELECT version, checksum FROM dzql.migrations ORDER BY version
    `;
    const appliedMap = new Map(applied.map(m => [m.version, m.checksum]));

    let ranCount = 0;
    let skippedCount = 0;

    for (const migration of migrations) {
      const filepath = join(migrationsPath, migration.filename);
      const content = await readFile(filepath, 'utf-8');
      const checksum = calculateChecksum(content);

      const existingChecksum = appliedMap.get(migration.version);

      if (existingChecksum) {
        // Migration already applied
        if (existingChecksum !== checksum) {
          // CRITICAL: Checksum changed - migration was modified!
          logger.error(`❌ Migration ${migration.version} (${migration.name}) has been modified!`);
          logger.error(`   Expected checksum: ${existingChecksum}`);
          logger.error(`   Actual checksum:   ${checksum}`);
          throw new Error(
            `Migration ${migration.version} was modified after being applied. ` +
            `This is dangerous and not allowed. ` +
            `Create a new migration instead.`
          );
        }

        skippedCount++;
        logger.debug(`⏭️  Skipping ${migration.version}_${migration.name} (already applied)`);
        continue;
      }

      // Run new migration
      logger.info(`▶️  Running ${migration.version}_${migration.name}...`);
      const startTime = Date.now();

      try {
        // Run migration in a transaction
        await sql.begin(async (sql) => {
          await sql.unsafe(content);

          // Record successful migration
          await sql`
            INSERT INTO dzql.migrations (version, name, checksum, execution_time_ms, success)
            VALUES (
              ${migration.version},
              ${migration.name},
              ${checksum},
              ${Date.now() - startTime},
              true
            )
          `;
        });

        ranCount++;
        logger.info(`✅ Completed ${migration.version}_${migration.name} (${Date.now() - startTime}ms)`);

      } catch (error) {
        logger.error(`❌ Failed ${migration.version}_${migration.name}:`, error.message);

        // Record failed migration
        await sql`
          INSERT INTO dzql.migrations (version, name, checksum, execution_time_ms, success)
          VALUES (
            ${migration.version},
            ${migration.name},
            ${checksum},
            ${Date.now() - startTime},
            false
          )
        `;

        throw new Error(`Migration ${migration.version} failed: ${error.message}`);
      }
    }

    logger.info(`✅ Migrations complete: ${ranCount} applied, ${skippedCount} skipped`);

  } catch (error) {
    logger.error('💥 Migration failed:', error);
    throw error;
  }
}

/**
 * Rollback last N migrations (for development only)
 * WARNING: This is destructive and should not be used in production
 */
export async function rollbackMigrations(sql, count = 1, options = {}) {
  const { logger = console } = options;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Rollback is not allowed in production!');
  }

  logger.warn(`⚠️  Rolling back last ${count} migration(s)...`);

  const migrations = await sql`
    SELECT version, name
    FROM dzql.migrations
    WHERE success = true
    ORDER BY applied_at DESC
    LIMIT ${count}
  `;

  for (const migration of migrations) {
    logger.warn(`⏪ Removing migration ${migration.version}_${migration.name} from tracking`);
    await sql`DELETE FROM dzql.migrations WHERE version = ${migration.version}`;
  }

  logger.warn(`⚠️  ${migrations.length} migration(s) rolled back. You must manually revert database changes!`);
}
```

#### Update Server to Use Migration Runner

**File:** `packages/dzql/src/server/db.js` (MODIFY)

```javascript
// Add at top of file
import { runMigrations } from '../database/migration-runner.js';
import { logger as baseLogger } from './logger.js';

const dbLogger = baseLogger.category('db');

// Modify createDb() function
export async function createDb(config = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    max = DB_MAX_CONNECTIONS,
    idle_timeout = DB_IDLE_TIMEOUT,
    connect_timeout = DB_CONNECT_TIMEOUT,
    runMigrationsOnStartup = true,  // NEW option
  } = config;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const sql = postgres(connectionString, {
    max,
    idle_timeout,
    connect_timeout,
    onnotice: () => {}, // Suppress notices
  });

  // NEW: Run migrations automatically
  if (runMigrationsOnStartup) {
    try {
      await runMigrations(sql, { logger: dbLogger });
    } catch (error) {
      dbLogger.error('Failed to run migrations:', error);
      throw error;
    }
  }

  // ... rest of existing code ...
}
```

#### CLI Tool for Migrations

**File:** `packages/dzql/src/database/cli/migrate.js` (NEW)

```javascript
#!/usr/bin/env node
import postgres from 'postgres';
import { runMigrations, rollbackMigrations } from '../migration-runner.js';

const command = process.argv[2];
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

try {
  switch (command) {
    case 'up':
    case 'migrate':
      await runMigrations(sql);
      break;

    case 'status':
      const migrations = await sql`
        SELECT version, name, applied_at, execution_time_ms, success
        FROM dzql.migrations
        ORDER BY version
      `;
      console.table(migrations);
      break;

    case 'rollback':
      const count = parseInt(process.argv[3] || '1', 10);
      await rollbackMigrations(sql, count);
      console.warn('⚠️  Database changes NOT reverted - do this manually!');
      break;

    default:
      console.log(`
DZQL Migration Tool

Usage:
  bun migrate up         Run pending migrations
  bun migrate status     Show migration status
  bun migrate rollback [N]   Rollback last N migrations (dev only)

Environment:
  DATABASE_URL          PostgreSQL connection string (required)
      `);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
} finally {
  await sql.end();
}
```

### Testing Requirements

#### 1. Test migration runner logic

**File:** `packages/dzql/tests/migrations/migration-runner.test.js` (NEW)

```javascript
import { test, expect, beforeAll, afterAll } from "bun:test";
import postgres from 'postgres';
import { runMigrations } from "dzql/src/database/migration-runner.js";
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let sql;
const testMigrationsDir = '/tmp/dzql-test-migrations';

beforeAll(async () => {
  sql = postgres(TEST_DB);

  // Clean up test migrations table
  await sql`DROP TABLE IF EXISTS dzql.migrations CASCADE`;

  // Create test migrations directory
  await mkdir(testMigrationsDir, { recursive: true });
});

afterAll(async () => {
  await sql.end();
  await rm(testMigrationsDir, { recursive: true, force: true });
});

test("migration runner creates migrations table", async () => {
  // Create minimal migration
  await writeFile(
    join(testMigrationsDir, '000_migrations.sql'),
    `CREATE SCHEMA IF NOT EXISTS dzql;
     CREATE TABLE IF NOT EXISTS dzql.migrations (
       version TEXT PRIMARY KEY,
       name TEXT,
       checksum TEXT,
       applied_at TIMESTAMPTZ DEFAULT NOW(),
       execution_time_ms INT,
       success BOOLEAN DEFAULT true
     );`
  );

  await runMigrations(sql, { migrationsPath: testMigrationsDir, logger: { info: () => {}, debug: () => {} } });

  const result = await sql`SELECT COUNT(*) as count FROM dzql.migrations`;
  expect(result[0].count).toBeGreaterThanOrEqual(0);
});

test("migration runner skips already-applied migrations", async () => {
  await writeFile(
    join(testMigrationsDir, '001_test.sql'),
    `SELECT 1;`
  );

  // Run twice
  await runMigrations(sql, { migrationsPath: testMigrationsDir, logger: { info: () => {}, debug: () => {} } });
  await runMigrations(sql, { migrationsPath: testMigrationsDir, logger: { info: () => {}, debug: () => {} } });

  const result = await sql`SELECT COUNT(*) as count FROM dzql.migrations WHERE version = '001'`;
  expect(result[0].count).toBe(1); // Only applied once
});

test("migration runner detects modified migrations", async () => {
  await writeFile(
    join(testMigrationsDir, '002_modify_test.sql'),
    `SELECT 2;`
  );

  // Apply first time
  await runMigrations(sql, { migrationsPath: testMigrationsDir, logger: { info: () => {}, debug: () => {} } });

  // Modify migration
  await writeFile(
    join(testMigrationsDir, '002_modify_test.sql'),
    `SELECT 3; -- MODIFIED`
  );

  // Should throw error
  await expect(
    runMigrations(sql, { migrationsPath: testMigrationsDir, logger: { info: () => {}, error: () => {}, debug: () => {} } })
  ).rejects.toThrow('modified after being applied');
});
```

### Success Criteria
- ✅ Migrations only run once
- ✅ Server startup doesn't re-run migrations
- ✅ Modified migrations are detected and rejected
- ✅ Migration status is queryable
- ✅ Rollback works in development
- ✅ All tests pass

### Deployment Steps
1. Create `000_migrations.sql`
2. Create `migration-runner.js`
3. Update `db.js` to call runner
4. Create CLI tool `migrate.js`
5. Add tests
6. Update all example apps to use new system
7. Document in README
8. Commit: `feat: add migration tracking system`

---

## Task 3: Add Rate Limiting

**Priority:** 🔴 CRITICAL
**Effort:** 1-2 days
**Impact:** HIGH - Security vulnerability without it

### Problem
No protection against:
- Brute force login attempts
- DoS via excessive WebSocket messages
- API abuse

### Solution Architecture

#### In-Memory Rate Limiter (Phase 1 - Quick Win)

**File:** `packages/dzql/src/server/rate-limiter.js` (NEW)

```javascript
/**
 * Simple in-memory rate limiter
 * For production use across multiple servers, use Redis instead
 */

export class RateLimiter {
  constructor(options = {}) {
    this.limits = new Map(); // userId -> {count, resetAt, blocked}
    this.config = {
      maxRequests: options.maxRequests || 100,     // Requests per window
      windowMs: options.windowMs || 60 * 1000,     // 1 minute default
      blockDurationMs: options.blockDurationMs || 15 * 60 * 1000, // 15 min block
      cleanupIntervalMs: options.cleanupIntervalMs || 5 * 60 * 1000, // Cleanup every 5 min
    };

    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Check if request is allowed for user
   * @param {string|number} userId - User identifier
   * @returns {Object} {allowed: boolean, remaining: number, resetAt: Date}
   */
  check(userId) {
    const now = Date.now();
    const key = String(userId);

    let record = this.limits.get(key);

    // Check if user is blocked
    if (record?.blocked && record.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(record.blockedUntil),
        blocked: true,
      };
    }

    // Initialize or reset if window expired
    if (!record || record.resetAt <= now) {
      record = {
        count: 0,
        resetAt: now + this.config.windowMs,
        blocked: false,
        blockedUntil: null,
      };
      this.limits.set(key, record);
    }

    // Increment counter
    record.count++;

    // Check if limit exceeded
    if (record.count > this.config.maxRequests) {
      // Block user
      record.blocked = true;
      record.blockedUntil = now + this.config.blockDurationMs;

      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(record.blockedUntil),
        blocked: true,
      };
    }

    return {
      allowed: true,
      remaining: this.config.maxRequests - record.count,
      resetAt: new Date(record.resetAt),
      blocked: false,
    };
  }

  /**
   * Reset limits for a user (useful for testing or manual unblock)
   */
  reset(userId) {
    this.limits.delete(String(userId));
  }

  /**
   * Clean up expired entries to prevent memory leaks
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, record] of this.limits.entries()) {
      // Remove if window expired and not blocked, or if block expired
      if (
        (!record.blocked && record.resetAt <= now) ||
        (record.blocked && record.blockedUntil <= now)
      ) {
        this.limits.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RateLimiter] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Get current stats
   */
  stats() {
    return {
      totalUsers: this.limits.size,
      blockedUsers: Array.from(this.limits.values()).filter(r => r.blocked).length,
      config: this.config,
    };
  }

  /**
   * Destroy rate limiter and stop cleanup
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.limits.clear();
  }
}

/**
 * Specialized rate limiter for login attempts
 * More restrictive than general API rate limiter
 */
export class LoginRateLimiter extends RateLimiter {
  constructor(options = {}) {
    super({
      maxRequests: options.maxRequests || 5,          // 5 attempts
      windowMs: options.windowMs || 15 * 60 * 1000,   // per 15 minutes
      blockDurationMs: options.blockDurationMs || 60 * 60 * 1000, // 1 hour block
      ...options,
    });
  }
}
```

#### Integrate Rate Limiter into WebSocket Handler

**File:** `packages/dzql/src/server/ws.js` (MODIFY)

```javascript
// Add imports at top
import { RateLimiter, LoginRateLimiter } from './rate-limiter.js';

// Create rate limiters (add near top of file, after imports)
const generalRateLimiter = new RateLimiter({
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 min
  blockDurationMs: parseInt(process.env.RATE_LIMIT_BLOCK_MS || '900000', 10), // 15 min
});

const loginRateLimiter = new LoginRateLimiter({
  maxRequests: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
  blockDurationMs: parseInt(process.env.LOGIN_RATE_LIMIT_BLOCK_MS || '3600000', 10), // 1 hour
});

// Modify handleRPC function
async function handleRPC(ws, message) {
  const { id, method, params = {} } = message;

  // Rate limit check (use IP or userId)
  const identifier = ws.data?.userId || ws.data?.ip || 'anonymous';

  // Special handling for login attempts
  if (method === 'login_user' || method === 'register_user') {
    const loginCheck = loginRateLimiter.check(params.email || identifier);
    if (!loginCheck.allowed) {
      wsLogger.warn(`Login rate limit exceeded for ${params.email || identifier}`);
      return create_rpc_error(
        id,
        -32429, // Custom: Too Many Requests
        `Too many login attempts. Try again at ${loginCheck.resetAt.toISOString()}`,
        {
          resetAt: loginCheck.resetAt.toISOString(),
          blocked: true
        }
      );
    }
  }

  // General rate limiting for authenticated users
  if (ws.data?.userId) {
    const generalCheck = generalRateLimiter.check(ws.data.userId);
    if (!generalCheck.allowed) {
      wsLogger.warn(`Rate limit exceeded for user ${ws.data.userId}`);
      return create_rpc_error(
        id,
        -32429,
        `Rate limit exceeded. Try again at ${generalCheck.resetAt.toISOString()}`,
        {
          resetAt: generalCheck.resetAt.toISOString(),
          remaining: 0,
        }
      );
    }
  }

  // ... rest of existing RPC handling ...
}

// Add rate limiter stats endpoint
export function getRateLimiterStats() {
  return {
    general: generalRateLimiter.stats(),
    login: loginRateLimiter.stats(),
  };
}
```

#### Add Rate Limiter Stats to Health Check

**File:** `packages/dzql/src/server/index.js` (MODIFY)

```javascript
import { getRateLimiterStats } from './ws.js';

// Modify createServer function
export function createServer(config = {}) {
  // ... existing code ...

  // Enhanced health check
  router.get('/health', async (req) => {
    const dbHealthy = await checkDatabaseHealth(db);

    return new Response(
      JSON.stringify({
        status: dbHealthy ? 'healthy' : 'degraded',
        database: dbHealthy,
        rateLimiter: getRateLimiterStats(),
        uptime: process.uptime(),
      }),
      {
        status: dbHealthy ? 200 : 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  });

  // ... rest of code ...
}

async function checkDatabaseHealth(db) {
  try {
    await db.sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
```

### Environment Variables

Add to `.env.example`:

```bash
# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100            # Max requests per window
RATE_LIMIT_WINDOW_MS=60000             # Window duration (1 minute)
RATE_LIMIT_BLOCK_MS=900000             # Block duration (15 minutes)

LOGIN_RATE_LIMIT_MAX=5                 # Max login attempts
LOGIN_RATE_LIMIT_WINDOW_MS=900000      # Login window (15 minutes)
LOGIN_RATE_LIMIT_BLOCK_MS=3600000      # Login block duration (1 hour)
```

### Testing Requirements

**File:** `packages/dzql/tests/rate-limiter.test.js` (NEW)

```javascript
import { test, expect, beforeEach } from "bun:test";
import { RateLimiter, LoginRateLimiter } from "dzql/src/server/rate-limiter.js";

let limiter;

beforeEach(() => {
  limiter = new RateLimiter({
    maxRequests: 3,
    windowMs: 1000, // 1 second window for fast tests
    blockDurationMs: 2000, // 2 second block
  });
});

test("allows requests under limit", () => {
  const check1 = limiter.check('user1');
  expect(check1.allowed).toBe(true);
  expect(check1.remaining).toBe(2);

  const check2 = limiter.check('user1');
  expect(check2.allowed).toBe(true);
  expect(check2.remaining).toBe(1);
});

test("blocks requests over limit", () => {
  limiter.check('user1'); // 1
  limiter.check('user1'); // 2
  limiter.check('user1'); // 3

  const blocked = limiter.check('user1'); // 4 - exceeds limit
  expect(blocked.allowed).toBe(false);
  expect(blocked.blocked).toBe(true);
  expect(blocked.remaining).toBe(0);
});

test("resets after window expires", async () => {
  limiter.check('user1');
  limiter.check('user1');
  limiter.check('user1');

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 1100));

  const check = limiter.check('user1');
  expect(check.allowed).toBe(true);
  expect(check.remaining).toBe(2);
});

test("unblocks after block duration", async () => {
  // Exceed limit to get blocked
  limiter.check('user1');
  limiter.check('user1');
  limiter.check('user1');
  const blocked = limiter.check('user1');
  expect(blocked.blocked).toBe(true);

  // Wait for block to expire
  await new Promise(resolve => setTimeout(resolve, 2100));

  const unblocked = limiter.check('user1');
  expect(unblocked.allowed).toBe(true);
});

test("rate limits different users independently", () => {
  limiter.check('user1');
  limiter.check('user1');
  limiter.check('user1');
  const blocked = limiter.check('user1');
  expect(blocked.blocked).toBe(true);

  // Different user should be allowed
  const user2Check = limiter.check('user2');
  expect(user2Check.allowed).toBe(true);
});

test("cleanup removes expired entries", async () => {
  limiter.check('user1');
  expect(limiter.stats().totalUsers).toBe(1);

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 1100));

  limiter.cleanup();
  expect(limiter.stats().totalUsers).toBe(0);
});

test("login rate limiter is more restrictive", () => {
  const loginLimiter = new LoginRateLimiter({
    maxRequests: 2,
    windowMs: 1000,
  });

  loginLimiter.check('user@example.com'); // 1
  loginLimiter.check('user@example.com'); // 2

  const blocked = loginLimiter.check('user@example.com'); // 3 - exceeds
  expect(blocked.allowed).toBe(false);
});
```

### Success Criteria
- ✅ Login attempts are rate-limited (5 per 15 min)
- ✅ General API calls are rate-limited (100 per minute)
- ✅ Blocked users receive clear error messages with reset time
- ✅ Rate limiter stats available in `/health` endpoint
- ✅ Memory doesn't grow unbounded (cleanup works)
- ✅ All tests pass

### Future Improvement (Phase 2)

**Redis-based rate limiter for multi-server deployments:**

```javascript
// packages/dzql/src/server/rate-limiter-redis.js
import Redis from 'ioredis';

export class RedisRateLimiter {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.config = options;
  }

  async check(userId) {
    const key = `ratelimit:${userId}`;
    const now = Date.now();

    // Use Redis sorted set for time-windowed counting
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, now - this.config.windowMs);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(this.config.windowMs / 1000));

    const results = await pipeline.exec();
    const count = results[2][1];

    return {
      allowed: count <= this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - count),
    };
  }
}
```

---

## Task 4: Unified Error Handling

**Priority:** 🟡 HIGH
**Effort:** 3-4 days
**Impact:** MEDIUM - Improves DX and security

### Problem
- Inconsistent error types (Error, PostgresError, strings)
- No error codes for programmatic handling
- Raw database errors exposed to client
- Security risk: stack traces leak implementation details

### Solution Architecture

#### Error Classification System

**File:** `packages/dzql/src/server/errors.js` (NEW)

```javascript
/**
 * Base class for all DZQL errors
 */
export class DZQLError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DZQLError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Don't expose stack traces in production
    if (process.env.NODE_ENV === 'production') {
      delete this.stack;
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends DZQLError {
  constructor(message = 'Authentication required', details = {}) {
    super('DZQL_AUTH_REQUIRED', message, details);
    this.name = 'AuthenticationError';
    this.httpStatus = 401;
  }
}

export class InvalidTokenError extends DZQLError {
  constructor(message = 'Invalid or expired token', details = {}) {
    super('DZQL_INVALID_TOKEN', message, details);
    this.name = 'InvalidTokenError';
    this.httpStatus = 401;
  }
}

/**
 * Authorization errors (403)
 */
export class PermissionDeniedError extends DZQLError {
  constructor(operation, entity, details = {}) {
    super(
      'DZQL_PERMISSION_DENIED',
      `You don't have permission to ${operation} ${entity}`,
      { operation, entity, ...details }
    );
    this.name = 'PermissionDeniedError';
    this.httpStatus = 403;
  }
}

/**
 * Not found errors (404)
 */
export class RecordNotFoundError extends DZQLError {
  constructor(entity, pk, details = {}) {
    super(
      'DZQL_NOT_FOUND',
      `${entity} not found`,
      { entity, pk, ...details }
    );
    this.name = 'RecordNotFoundError';
    this.httpStatus = 404;
  }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends DZQLError {
  constructor(message, fields = {}, details = {}) {
    super('DZQL_VALIDATION_ERROR', message, { fields, ...details });
    this.name = 'ValidationError';
    this.httpStatus = 400;
  }
}

export class GraphRuleValidationError extends DZQLError {
  constructor(rule, message, details = {}) {
    super(
      'DZQL_GRAPH_RULE_FAILED',
      message || `Graph rule validation failed: ${rule}`,
      { rule, ...details }
    );
    this.name = 'GraphRuleValidationError';
    this.httpStatus = 400;
  }
}

/**
 * Conflict errors (409)
 */
export class ConflictError extends DZQLError {
  constructor(message, details = {}) {
    super('DZQL_CONFLICT', message, details);
    this.name = 'ConflictError';
    this.httpStatus = 409;
  }
}

/**
 * Server errors (500)
 */
export class DatabaseError extends DZQLError {
  constructor(message = 'Database operation failed', details = {}) {
    super('DZQL_DATABASE_ERROR', message, details);
    this.name = 'DatabaseError';
    this.httpStatus = 500;
  }
}

/**
 * Rate limit errors (429)
 */
export class RateLimitError extends DZQLError {
  constructor(resetAt, details = {}) {
    super(
      'DZQL_RATE_LIMIT',
      `Rate limit exceeded. Try again at ${resetAt}`,
      { resetAt, ...details }
    );
    this.name = 'RateLimitError';
    this.httpStatus = 429;
  }
}

/**
 * Maps PostgreSQL errors to DZQL errors
 */
export function mapPostgresError(error) {
  // PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html

  switch (error.code) {
    case '23505': // unique_violation
      return new ConflictError(
        'A record with this value already exists',
        { constraint: error.constraint_name, field: error.column_name }
      );

    case '23503': // foreign_key_violation
      return new ValidationError(
        'Referenced record does not exist',
        { constraint: error.constraint_name }
      );

    case '23502': // not_null_violation
      return new ValidationError(
        `Field '${error.column_name}' is required`,
        { [error.column_name]: 'Required field' }
      );

    case '23514': // check_violation
      return new ValidationError(
        'Field value does not meet requirements',
        { constraint: error.constraint_name }
      );

    case '42P01': // undefined_table
      return new DatabaseError(
        'Entity not configured',
        { table: error.table_name }
      );

    case '42703': // undefined_column
      return new ValidationError(
        `Invalid field: ${error.column_name}`,
        { field: error.column_name }
      );

    default:
      // Don't expose internal database errors to client
      if (process.env.NODE_ENV === 'production') {
        return new DatabaseError('An error occurred processing your request');
      } else {
        return new DatabaseError(error.message, { code: error.code });
      }
  }
}

/**
 * Checks if error message indicates a specific DZQL condition
 */
export function parseErrorMessage(message) {
  if (message === 'record not found') {
    return new RecordNotFoundError('Resource', {});
  }

  if (message.includes('Permission denied:')) {
    const match = message.match(/Permission denied: (\w+) on (\w+)/);
    if (match) {
      return new PermissionDeniedError(match[1], match[2]);
    }
  }

  if (message.includes('entity') && message.includes('not configured')) {
    const match = message.match(/entity (\w+) not configured/);
    if (match) {
      return new DatabaseError(`Entity '${match[1]}' not configured`);
    }
  }

  return null;
}
```

#### Update WebSocket Handler to Use Errors

**File:** `packages/dzql/src/server/ws.js` (MODIFY)

```javascript
import {
  DZQLError,
  AuthenticationError,
  InvalidTokenError,
  RateLimitError,
  mapPostgresError,
  parseErrorMessage,
} from './errors.js';

// Modify handleRPC function error handling
async function handleRPC(ws, message) {
  const { id, method, params = {} } = message;

  try {
    // ... existing rate limiting code ...

    // Check authentication for protected methods
    if (method !== 'login_user' && method !== 'register_user') {
      if (!ws.data?.userId) {
        throw new AuthenticationError();
      }
    }

    // ... rest of RPC handling ...

  } catch (error) {
    wsLogger.error(`RPC error in ${method}:`, error);

    // Convert to DZQL error if needed
    let dzqlError = error;

    if (error instanceof DZQLError) {
      // Already a DZQL error
      dzqlError = error;
    } else if (error.code && error.severity) {
      // PostgreSQL error
      dzqlError = mapPostgresError(error);
    } else if (typeof error.message === 'string') {
      // Check for known error messages
      const parsed = parseErrorMessage(error.message);
      dzqlError = parsed || new DZQLError('DZQL_UNKNOWN_ERROR', error.message);
    } else {
      dzqlError = new DZQLError('DZQL_UNKNOWN_ERROR', 'An error occurred');
    }

    return create_rpc_error(
      id,
      dzqlError.httpStatus ? -32000 - dzqlError.httpStatus : -32603,
      dzqlError.message,
      dzqlError.toJSON()
    );
  }
}
```

### Client Error Handling Helper

**File:** `packages/dzql/src/client/error-handler.js` (NEW)

```javascript
/**
 * Client-side error handling utilities
 */

export class DZQLClientError extends Error {
  constructor(rpcError) {
    super(rpcError.message);
    this.code = rpcError.data?.code || 'DZQL_UNKNOWN_ERROR';
    this.details = rpcError.data?.details || {};
    this.timestamp = rpcError.data?.timestamp;
  }

  isAuthError() {
    return this.code === 'DZQL_AUTH_REQUIRED' || this.code === 'DZQL_INVALID_TOKEN';
  }

  isPermissionError() {
    return this.code === 'DZQL_PERMISSION_DENIED';
  }

  isNotFound() {
    return this.code === 'DZQL_NOT_FOUND';
  }

  isValidationError() {
    return this.code === 'DZQL_VALIDATION_ERROR';
  }

  isRateLimit() {
    return this.code === 'DZQL_RATE_LIMIT';
  }
}

/**
 * Example usage in client code:
 *
 * try {
 *   const venue = await ws.api.get.venues({id: 1});
 * } catch (rpcError) {
 *   const error = new DZQLClientError(rpcError);
 *
 *   if (error.isNotFound()) {
 *     // Show 404 page
 *   } else if (error.isPermissionError()) {
 *     // Show access denied message
 *   } else if (error.isAuthError()) {
 *     // Redirect to login
 *   } else if (error.isValidationError()) {
 *     // Show field validation errors
 *     console.log(error.details.fields);
 *   }
 * }
 */
```

### Testing Requirements

**File:** `packages/dzql/tests/errors.test.js` (NEW)

```javascript
import { test, expect } from "bun:test";
import {
  DZQLError,
  PermissionDeniedError,
  RecordNotFoundError,
  ValidationError,
  mapPostgresError,
  parseErrorMessage,
} from "dzql/src/server/errors.js";

test("DZQLError includes error code and details", () => {
  const error = new DZQLError('TEST_CODE', 'Test message', { foo: 'bar' });

  expect(error.code).toBe('TEST_CODE');
  expect(error.message).toBe('Test message');
  expect(error.details.foo).toBe('bar');
  expect(error.timestamp).toBeDefined();
});

test("PermissionDeniedError formats message correctly", () => {
  const error = new PermissionDeniedError('view', 'venues', { userId: 123 });

  expect(error.code).toBe('DZQL_PERMISSION_DENIED');
  expect(error.message).toBe("You don't have permission to view venues");
  expect(error.details.operation).toBe('view');
  expect(error.details.entity).toBe('venues');
  expect(error.details.userId).toBe(123);
});

test("mapPostgresError converts unique violation", () => {
  const pgError = {
    code: '23505',
    constraint_name: 'users_email_key',
    column_name: 'email',
  };

  const dzqlError = mapPostgresError(pgError);

  expect(dzqlError.code).toBe('DZQL_CONFLICT');
  expect(dzqlError.message).toContain('already exists');
  expect(dzqlError.details.constraint).toBe('users_email_key');
});

test("mapPostgresError converts foreign key violation", () => {
  const pgError = {
    code: '23503',
    constraint_name: 'venues_org_id_fkey',
  };

  const dzqlError = mapPostgresError(pgError);

  expect(dzqlError.code).toBe('DZQL_VALIDATION_ERROR');
  expect(dzqlError.message).toContain('does not exist');
});

test("parseErrorMessage extracts permission denied", () => {
  const error = parseErrorMessage('Permission denied: view on venues');

  expect(error).toBeInstanceOf(PermissionDeniedError);
  expect(error.details.operation).toBe('view');
  expect(error.details.entity).toBe('venues');
});

test("parseErrorMessage extracts record not found", () => {
  const error = parseErrorMessage('record not found');

  expect(error).toBeInstanceOf(RecordNotFoundError);
  expect(error.code).toBe('DZQL_NOT_FOUND');
});

test("error.toJSON() serializes correctly", () => {
  const error = new ValidationError('Invalid input', { email: 'Invalid email' });
  const json = error.toJSON();

  expect(json.code).toBe('DZQL_VALIDATION_ERROR');
  expect(json.message).toBe('Invalid input');
  expect(json.details.fields.email).toBe('Invalid email');
  expect(json.timestamp).toBeDefined();
});
```

### Success Criteria
- ✅ All errors use DZQLError subclasses
- ✅ PostgreSQL errors are mapped to user-friendly messages
- ✅ Stack traces hidden in production
- ✅ Error codes are consistent and documented
- ✅ Client can programmatically handle error types
- ✅ All tests pass

---

## Task 5: Add Test Coverage Reporting

**Priority:** 🟡 HIGH
**Effort:** 2-3 hours
**Impact:** LOW - Quality assurance

### Solution

#### 1. Update package.json

**File:** `packages/dzql/package.json` (MODIFY)

```json
{
  "scripts": {
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "test:watch": "bun test --watch"
  }
}
```

#### 2. Add coverage configuration

**File:** `packages/dzql/bunfig.toml` (NEW or UPDATE)

```toml
[test]
coverage = true
coverageThreshold = 70  # Minimum 70% coverage
coverageReporter = ["text", "lcov", "html"]
coverageDir = "./coverage"

# Exclude files from coverage
coverageSkipTestFiles = true
coverageExclude = [
  "**/tests/**",
  "**/cli/**",
  "**/*.test.js",
  "**/*.config.js"
]
```

#### 3. Add coverage reporting to CI

**File:** `.github/workflows/test.yml` (NEW)

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: dzql_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - run: bun install

      - name: Run tests with coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/dzql_test
        run: bun test --coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
```

#### 4. Update .gitignore

```gitignore
# Coverage
coverage/
*.lcov
.nyc_output/
```

### Success Criteria
- ✅ `bun test --coverage` generates report
- ✅ Coverage threshold enforced (70%)
- ✅ HTML report viewable locally
- ✅ CI uploads coverage to Codecov
- ✅ Badge added to README

---

## Phase 2: Medium-Term Improvements (Week 3-6)

### Task 6: Redis-Backed Subscriptions

**Priority:** 🟡 MEDIUM
**Effort:** 1 week
**Impact:** HIGH for horizontal scaling

**Problem:** In-memory subscription state prevents multi-server deployments

**Solution:** Use Redis pub/sub + hash storage

**Estimated completion:** Week 4

---

### Task 7: Enhanced Observability

**Priority:** 🟡 MEDIUM
**Effort:** 1 week
**Impact:** MEDIUM for production ops

**Features:**
- Structured JSON logging option
- Prometheus metrics endpoint
- Slow query logging
- Request tracing IDs

**Estimated completion:** Week 5

---

### Task 8: Production Deployment Guide

**Priority:** 🟡 MEDIUM
**Effort:** 3 days
**Impact:** HIGH for adoption

**Content:**
- Docker Compose production setup
- Heroku deployment
- Railway deployment
- Render deployment
- Environment variable reference
- Scaling strategies

**Estimated completion:** Week 6

---

## Phase 3: Long-Term Enhancements (Week 7-12)

### Task 9: TypeScript Definitions

**Effort:** 1-2 weeks

Generate `.d.ts` files for:
- Client API
- Server API
- Error types
- Configuration options

---

### Task 10: Query Optimization Tools

**Effort:** 2-3 weeks

- SQL formatter for generated code
- Index recommendations
- Query plan visualization
- Performance profiling

---

### Task 11: Admin UI

**Effort:** 4-6 weeks

Web interface for:
- Entity inspection
- Event log viewing
- Subscription monitoring
- Rate limiter management

---

## Summary Timeline

### 🚀 Version 0.3.0 Alpha (Week 2)
- ✅ Compiler bug fixed
- ✅ Migration system implemented
- ✅ Basic rate limiting added
- ✅ Test coverage reporting
**Release Target:** End of Week 2

### 🔷 Version 0.5.0 Beta (Week 6)
- ✅ Unified error handling
- ✅ Redis subscriptions
- ✅ Enhanced observability
- ✅ Deployment guides
**Release Target:** End of Week 6

### 💎 Version 1.0.0 Production (Week 12+)
- ✅ TypeScript support
- ✅ Query optimization
- ✅ 3-6 months production testing
- ✅ Security audit
- ✅ Community feedback integrated

---

## Resource Requirements

### Time Commitment
- **Phase 1 (Critical):** 7-10 days full-time
- **Phase 2 (Medium-term):** 2-3 weeks part-time
- **Phase 3 (Long-term):** 8-12 weeks part-time

### Skills Needed
- PostgreSQL (migrations, performance)
- JavaScript/Bun (server implementation)
- Testing (Bun test framework)
- DevOps (Docker, deployment platforms)
- Optional: Redis, TypeScript, Prometheus

---

## Next Steps

**Immediate actions (this week):**

1. **Fix compiler bug** (Task 1) - 4-6 hours
   - File: `packages/dzql/src/compiler/codegen/operation-codegen.js`
   - Add conditional graph function call generation
   - Write test, verify fix

2. **Implement migration system** (Task 2) - 2-3 days
   - Create `000_migrations.sql`
   - Build `migration-runner.js`
   - Update `db.js` to use runner
   - Test with existing migrations

3. **Add rate limiting** (Task 3) - 1-2 days
   - Create `rate-limiter.js`
   - Integrate into `ws.js`
   - Add environment variables
   - Write tests

**End of week goals:**
- All 3 critical fixes deployed
- Tests passing
- Ready for 0.3.0-alpha release

---

## Questions for You

Before starting execution, please confirm:

1. **Priority:** Do these priorities align with your vision?
2. **Timeline:** Is 2 weeks for Phase 1 realistic for you?
3. **Scope:** Should I start with Task 1 (compiler bug) immediately?
4. **Help:** Do you want me to implement these fixes, or guide you?
5. **Release:** Do you want to publish 0.3.0-alpha after Phase 1?

Let me know and I'll start executing! 🚀
