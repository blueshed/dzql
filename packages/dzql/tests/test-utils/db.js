import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * TestDatabase - Manages test database lifecycle
 *
 * Creates an isolated test database per test suite using process.pid
 * Runs all DZQL migrations automatically
 * Cleans up after tests complete
 *
 * Works in both:
 * - Docker (postgres://postgres:postgres@localhost:5432)
 * - Claude Web (postgres://postgres@localhost:5432 with trust auth)
 * - Local Postgres (postgres://postgres@localhost:5432)
 */
export class TestDatabase {
  constructor() {
    this.adminSql = null;
    this.testSql = null;
    this.dbName = `dzql_test_${process.pid}`;
    this.baseUrl = getDatabaseUrl();
  }

  /**
   * Setup test database:
   * 1. Connect as admin
   * 2. Create fresh test database
   * 3. Run all migrations
   * 4. Return connection to test database
   */
  async setup() {
    try {
      // Connect as admin to postgres database
      const adminUrl = this.baseUrl.replace(/\/[^/]*$/, '/postgres');
      this.adminSql = postgres(adminUrl, { max: 1 });

      // Drop and create fresh test database
      await this.adminSql.unsafe(`DROP DATABASE IF EXISTS ${this.dbName}`);
      await this.adminSql.unsafe(`CREATE DATABASE ${this.dbName}`);

      // Connect to test database
      const testUrl = this.baseUrl.replace(/\/[^/]*$/, `/${this.dbName}`);
      this.testSql = postgres(testUrl);

      // Run migrations in order
      await this.runMigrations();

      return this.testSql;
    } catch (error) {
      console.error('Failed to setup test database:', error.message);
      throw error;
    }
  }

  /**
   * Run all DZQL migrations in order
   */
  async runMigrations() {
    const migrationsDir = resolve(__dirname, '../../src/database/migrations');
    const migrations = [
      '001_schema.sql',
      '002_functions.sql',
      '003_operations.sql',
      '004_search.sql',
      '005_entities.sql',
      '006_auth.sql',
      '007_events.sql',
      '008_hello.sql',
      '008a_meta.sql',
      '009_subscriptions.sql'
    ];

    for (const migration of migrations) {
      const sql = readFileSync(resolve(migrationsDir, migration), 'utf-8');
      await this.testSql.unsafe(sql);
    }
  }

  /**
   * Teardown test database:
   * 1. Close test connection
   * 2. Drop test database
   * 3. Close admin connection
   */
  async teardown() {
    try {
      // Close test connection
      if (this.testSql) {
        await this.testSql.end();
      }

      // Drop test database
      if (this.adminSql) {
        await this.adminSql.unsafe(`DROP DATABASE IF EXISTS ${this.dbName}`);
        await this.adminSql.end();
      }
    } catch (error) {
      console.error('Failed to teardown test database:', error.message);
      // Don't throw - we want tests to complete even if cleanup fails
    }
  }

  /**
   * Helper for transaction-based test isolation
   * Automatically rolls back after test
   */
  async withTransaction(fn) {
    await this.testSql.begin(async (tx) => {
      await fn(tx);
      // Automatic rollback at end of scope
      throw new Error('ROLLBACK'); // Force rollback
    }).catch((err) => {
      if (err.message !== 'ROLLBACK') throw err;
    });
  }
}

/**
 * Get database URL based on environment
 *
 * Priority:
 * 1. TEST_DATABASE_URL (explicit override)
 * 2. DATABASE_URL (from .env)
 * 3. Default (works for Claude Web, Docker, Local)
 */
function getDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Default for Docker/Local (with password)
  // For Claude Web, set TEST_DATABASE_URL=postgres://postgres@localhost:5432/dzql_test
  return 'postgres://postgres:postgres@localhost:5432/dzql_test';
}
