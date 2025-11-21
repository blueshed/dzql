/**
 * Database setup utilities for testing
 * Handles migrations, schema setup, and test data seeding
 */

import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../packages/dzql/src/database/migrations');

/**
 * Create a test database connection
 * Uses local PostgreSQL configured with trust authentication
 */
export function createTestConnection(dbName = 'dzql_test') {
  return postgres({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    database: dbName,
    username: process.env.POSTGRES_USER || 'postgres',
    // No password needed with trust authentication
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  });
}

/**
 * Run all migrations in order
 */
export async function runMigrations(sql) {
  console.log('🔄 Running migrations...');

  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files
    .filter(f => f.endsWith('.sql'))
    .sort(); // Ensure migrations run in order

  for (const file of sqlFiles) {
    console.log(`  📄 Applying ${file}`);
    const migrationSQL = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    await sql.unsafe(migrationSQL);
  }

  console.log('✅ Migrations complete');
}

/**
 * Clean all test data (but keep schema)
 */
export async function cleanTestData(sql) {
  console.log('🧹 Cleaning test data...');

  // Get all tables in public schema
  const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != 'pg_stat_statements'
  `;

  // Disable triggers and truncate all tables
  for (const { tablename } of tables) {
    await sql.unsafe(`TRUNCATE TABLE ${tablename} CASCADE`);
  }

  // Clean dzql.events table
  await sql`TRUNCATE TABLE dzql.events CASCADE`;

  console.log('✅ Test data cleaned');
}

/**
 * Drop and recreate the test database schema
 */
export async function resetDatabase(sql) {
  console.log('🔄 Resetting database...');

  // Drop all tables in public schema
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`GRANT ALL ON SCHEMA public TO postgres`;
  await sql`GRANT ALL ON SCHEMA public TO public`;

  // Drop dzql schema if exists
  await sql`DROP SCHEMA IF EXISTS dzql CASCADE`;

  console.log('✅ Database reset complete');
}

/**
 * Setup test database with migrations
 */
export async function setupTestDatabase() {
  const sql = createTestConnection();

  try {
    await resetDatabase(sql);
    await runMigrations(sql);
    return sql;
  } catch (error) {
    await sql.end();
    throw error;
  }
}

/**
 * Create a test user and return their ID
 */
export async function createTestUser(sql, email, password = 'testpass123') {
  const result = await sql`
    SELECT register_user(${email}, ${password}) as result
  `;
  return result[0].result;
}

/**
 * Seed venues test data
 */
export async function seedVenuesData(sql) {
  console.log('🌱 Seeding venues test data...');

  // Create schema if needed
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      name text NOT NULL,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS organisations (
      id serial PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS acts_for (
      id serial PRIMARY KEY,
      user_id int REFERENCES users(id),
      org_id int REFERENCES organisations(id),
      valid_from timestamptz DEFAULT now(),
      valid_to timestamptz,
      active boolean DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS venues (
      id serial PRIMARY KEY,
      name text NOT NULL,
      address text,
      description text,
      org_id int REFERENCES organisations(id),
      owner_id int REFERENCES users(id),
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sites (
      id serial PRIMARY KEY,
      name text NOT NULL,
      venue_id int REFERENCES venues(id),
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS brands (
      id serial PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tags (
      id serial PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS brand_tags (
      brand_id int REFERENCES brands(id) ON DELETE CASCADE,
      tag_id int REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (brand_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS resources (
      id serial PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS events (
      id serial PRIMARY KEY,
      title text NOT NULL,
      description text,
      resource_id int REFERENCES resources(id),
      owner_id int REFERENCES users(id),
      created_at timestamptz DEFAULT now()
    );
  `;

  console.log('✅ Venues schema created');
}

/**
 * Seed blog test data
 */
export async function seedBlogData(sql) {
  console.log('🌱 Seeding blog test data...');

  // Create blog schema
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      name text NOT NULL,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id serial PRIMARY KEY,
      title text NOT NULL,
      content text NOT NULL,
      summary text,
      author_id int REFERENCES users(id),
      created_at timestamptz DEFAULT now(),
      deleted_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS comments (
      id serial PRIMARY KEY,
      content text NOT NULL,
      post_id int REFERENCES posts(id),
      author_id int REFERENCES users(id),
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tags (
      id serial PRIMARY KEY,
      name text UNIQUE NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id int REFERENCES posts(id) ON DELETE CASCADE,
      tag_id int REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );
  `;

  // Seed initial users with proper password hashing
  await sql`
    INSERT INTO users (name, email, password_hash)
    VALUES
      ('Alice', 'alice@blog.com', crypt('password123', gen_salt('bf'))),
      ('Bob', 'bob@blog.com', crypt('password123', gen_salt('bf')))
    ON CONFLICT (email) DO NOTHING
  `;

  console.log('✅ Blog schema and seed data created');
}

/**
 * Wait for database to be ready
 */
export async function waitForDatabase(maxAttempts = 30) {
  console.log('⏳ Waiting for database to be ready...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const sql = createTestConnection();
      await sql`SELECT 1`;
      await sql.end();
      console.log('✅ Database is ready');
      return true;
    } catch (error) {
      if (i === maxAttempts - 1) {
        throw new Error(`Database not ready after ${maxAttempts} attempts`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
