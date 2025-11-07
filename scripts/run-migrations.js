#!/usr/bin/env bun
/**
 * Migration runner for DZQL
 * Applies all SQL migrations to PostgreSQL in order
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dzql:dzql@localhost:5432/dzql';
const MIGRATIONS_DIR = join(import.meta.dir, '../packages/dzql/src/database/migrations');

console.log('🔧 DZQL Migration Runner');
console.log(`📁 Migrations directory: ${MIGRATIONS_DIR}`);
console.log(`🔌 Database: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}\n`);

const sql = postgres(DATABASE_URL, {
  max: 1,
  onnotice: () => {} // Suppress NOTICE messages
});

try {
  // Read all migration files
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files
    .filter(f => f.endsWith('.sql'))
    .sort(); // Alphabetical order (001, 002, etc.)

  console.log(`📋 Found ${sqlFiles.length} migration files\n`);

  // Execute each migration
  for (const file of sqlFiles) {
    const filePath = join(MIGRATIONS_DIR, file);
    console.log(`⏳ Running migration: ${file}`);

    const content = await readFile(filePath, 'utf-8');

    try {
      await sql.unsafe(content);
      console.log(`✅ Success: ${file}\n`);
    } catch (error) {
      console.error(`❌ Failed: ${file}`);
      console.error(`   Error: ${error.message}\n`);
      throw error;
    }
  }

  console.log('✅ All migrations completed successfully');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  await sql.end();
}
