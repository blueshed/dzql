#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { DZQLCompiler } from '../src/compiler/compiler.js';
import postgres from 'postgres';

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'create':
    console.log('🚧 Create command coming soon');
    console.log(`Would create project: ${args[0]}`);
    break;
  case 'dev':
    console.log('🚧 Dev command coming soon');
    break;
  case 'db:init':
    await runDbInit(args);
    break;
  case 'compile':
    await runCompile(args);
    break;
  case 'migrate:new':
  case 'migrate:init':
    await runMigrateNew(args);
    break;
  case 'migrate:up':
    await runMigrateUp(args);
    break;
  case 'migrate:down':
    await runMigrateDown(args);
    break;
  case 'migrate:status':
    await runMigrateStatus(args);
    break;
  case '--version':
  case '-v':
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    console.log(pkg.default.version);
    break;
  default:
    console.log(`
DZQL CLI

Quick Start:
  1. dzql db:init              Initialize database with DZQL core (~70 lines SQL)
  2. dzql compile app.sql      Compile your entities to PostgreSQL functions
  3. psql < compiled/*.sql     Apply the compiled SQL to your database

Commands:
  dzql db:init                  Initialize database with DZQL core schema
  dzql compile <input>          Compile entity definitions to SQL functions

  dzql migrate:new <name>       Create a new migration file
  dzql migrate:up               Apply pending migrations
  dzql migrate:status           Show migration status

  dzql --version                Show version

Examples:
  dzql db:init
  dzql compile entities/blog.sql -o init_db/
`);
}

async function runCompile(args) {
  const options = {
    output: './compiled',
    verbose: false
  };

  // Parse args
  let inputFile = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`
DZQL Compiler - Transform entity definitions into PostgreSQL functions

Usage:
  dzql compile <input-file> [options]

Options:
  -o, --output <dir>       Output directory (default: ./compiled)
  -v, --verbose            Verbose output
  -h, --help               Show this help message

Examples:
  dzql compile entities/venues.sql
  dzql compile database/init_db/009_venues_domain.sql -o compiled/
`);
      return;
    } else if (!inputFile) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error('Error: No input file specified');
    console.log('Run "dzql compile --help" for usage information');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    console.log(`\n🔨 Compiling: ${inputFile}`);

    // Read input file
    const sqlContent = readFileSync(inputFile, 'utf-8');

    // Compile
    const compiler = new DZQLCompiler();
    const result = compiler.compileFromSQL(sqlContent);

    // Display results
    console.log(`\n📊 Compilation Summary:`);
    console.log(`   Total entities: ${result.summary.total}`);
    console.log(`   Successful: ${result.summary.successful}`);
    console.log(`   Failed: ${result.summary.failed}`);

    if (result.errors.length > 0) {
      console.log(`\n❌ Errors:`);
      for (const error of result.errors) {
        console.log(`   - ${error.entity}: ${error.error}`);
      }
    }

    // Write output files
    if (result.results.length > 0) {
      // Ensure output directory exists
      if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
      }

      console.log(`\n📝 Writing compiled files to: ${options.output}`);

      // Write core DZQL infrastructure
      const coreSQL = `-- DZQL Core Schema and Tables

CREATE SCHEMA IF NOT EXISTS dzql;

-- Meta information
CREATE TABLE IF NOT EXISTS dzql.meta (
  installed_at timestamptz DEFAULT now(),
  version text NOT NULL
);

INSERT INTO dzql.meta (version) VALUES ('3.0.0') ON CONFLICT DO NOTHING;

-- Entity Configuration Table
CREATE TABLE IF NOT EXISTS dzql.entities (
  table_name text PRIMARY KEY,
  label_field text NOT NULL,
  searchable_fields text[] NOT NULL,
  fk_includes jsonb DEFAULT '{}',
  soft_delete boolean DEFAULT false,
  temporal_fields jsonb DEFAULT '{}',
  notification_paths jsonb DEFAULT '{}',
  permission_paths jsonb DEFAULT '{}',
  graph_rules jsonb DEFAULT '{}',
  field_defaults jsonb DEFAULT '{}',
  many_to_many jsonb DEFAULT '{}'
);

-- Registry of callable functions
CREATE TABLE IF NOT EXISTS dzql.registry (
  fn_regproc regproc PRIMARY KEY,
  description text
);

-- Event Audit Table for real-time notifications
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL,
  pk jsonb NOT NULL,
  data jsonb,
  user_id int,
  notify_users int[],
  at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS dzql_events_user_idx ON dzql.events (user_id, at);
CREATE INDEX IF NOT EXISTS dzql_events_event_id_idx ON dzql.events (event_id);

-- Event notification trigger
CREATE OR REPLACE FUNCTION dzql.notify_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('dzql', jsonb_build_object(
    'event_id', NEW.event_id,
    'table', NEW.table_name,
    'op', NEW.op,
    'pk', NEW.pk,
    'data', NEW.data,
    'user_id', NEW.user_id,
    'at', NEW.at,
    'notify_users', NEW.notify_users
  )::text);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS dzql_events_notify ON dzql.events;
CREATE TRIGGER dzql_events_notify
  AFTER INSERT ON dzql.events
  FOR EACH ROW EXECUTE FUNCTION dzql.notify_event();
`;

      writeFileSync(resolve(options.output, '000_dzql_core.sql'), coreSQL, 'utf-8');
      console.log(`   ✓ 000_dzql_core.sql`);

      // Extract schema SQL (everything before DZQL entity registrations)
      const schemaSQL = sqlContent.split(/-- DZQL Entity Registrations|select dzql\.register_entity/i)[0].trim();
      if (schemaSQL) {
        writeFileSync(resolve(options.output, '001_schema.sql'), schemaSQL + '\n', 'utf-8');
        console.log(`   ✓ 001_schema.sql`);
      }

      // Generate auth functions (required for WebSocket server)
      // This is a fallback for when there's no users entity - otherwise users.sql has these
      const authSQL = `-- Authentication Functions (fallback)
-- Required for DZQL WebSocket server
-- Note: If you have a users entity, auth functions are in users.sql instead

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Register new user
-- p_options: optional JSON object with additional fields to set on the user record
CREATE OR REPLACE FUNCTION register_user(p_email TEXT, p_password TEXT, p_options JSON DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id INT;
  v_salt TEXT;
  v_hash TEXT;
  v_insert_data JSONB;
BEGIN
  -- Generate salt and hash password
  v_salt := gen_salt('bf', 10);
  v_hash := crypt(p_password, v_salt);

  -- Build insert data: options fields + email + password_hash
  -- Cast p_options to JSONB for internal operations (JSON type is for API boundary convenience)
  v_insert_data := jsonb_build_object('email', p_email, 'password_hash', v_hash);
  IF p_options IS NOT NULL THEN
    v_insert_data := (p_options::jsonb - 'id' - 'email' - 'password_hash' - 'password') || v_insert_data;
  END IF;

  -- Dynamic INSERT from JSONB
  EXECUTE (
    SELECT format(
      'INSERT INTO users (%s) VALUES (%s) RETURNING id',
      string_agg(quote_ident(key), ', '),
      string_agg(quote_nullable(value), ', ')
    )
    FROM jsonb_each_text(v_insert_data) kv(key, value)
  ) INTO v_user_id;

  RETURN _profile(v_user_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Email already exists' USING errcode = '23505';
END $$;

-- Login user
CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_record RECORD;
BEGIN
  SELECT id, email, password_hash
  INTO v_user_record
  FROM users
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  IF NOT (v_user_record.password_hash = crypt(p_password, v_user_record.password_hash)) THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  RETURN _profile(v_user_record.id);
END $$;

-- Get user profile (private function, called after login/register)
-- Returns all columns except sensitive fields
CREATE OR REPLACE FUNCTION _profile(p_user_id INT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object('user_id', u.id) || (to_jsonb(u.*) - 'id' - 'password_hash' - 'password' - 'secret' - 'token')
  FROM users u
  WHERE id = p_user_id;
$$;
`;

      // Only generate 002_auth.sql if there's no users entity (which has its own auth functions)
      const hasUsersEntity = result.results.some(r => r.tableName === 'users');
      if (!hasUsersEntity) {
        writeFileSync(resolve(options.output, '002_auth.sql'), authSQL, 'utf-8');
        console.log(`   ✓ 002_auth.sql`);
      }

      const checksums = {};

      for (const compiledResult of result.results) {
        const outputFile = resolve(options.output, `${compiledResult.tableName}.sql`);

        // Write SQL file
        writeFileSync(outputFile, compiledResult.sql, 'utf-8');

        // Store checksum
        checksums[compiledResult.tableName] = {
          checksum: compiledResult.checksum,
          generatedAt: compiledResult.generatedAt,
          compilationTime: compiledResult.compilationTime
        };

        console.log(`   ✓ ${compiledResult.tableName}.sql (${compiledResult.checksum.substring(0, 8)}...)`);
      }

      // Write checksums file
      const checksumsFile = resolve(options.output, 'checksums.json');
      writeFileSync(checksumsFile, JSON.stringify(checksums, null, 2), 'utf-8');

      console.log(`   ✓ checksums.json`);

      // Write drop-semantics.json (drag-and-drop manifest for canvas UI)
      if (result.dropSemantics) {
        const semanticsFile = resolve(options.output, 'drop-semantics.json');
        writeFileSync(semanticsFile, JSON.stringify(result.dropSemantics, null, 2), 'utf-8');
        console.log(`   ✓ drop-semantics.json`);
      }
    }

    // Compile subscribables (if any register_subscribable calls exist)
    const subscribableResult = compiler.compileSubscribablesFromSQL(sqlContent);

    if (subscribableResult.results.length > 0) {
      console.log(`\n📊 Subscribable Compilation:`);
      console.log(`   Total subscribables: ${subscribableResult.summary.total}`);
      console.log(`   Successful: ${subscribableResult.summary.successful}`);
      console.log(`   Failed: ${subscribableResult.summary.failed}`);

      if (subscribableResult.errors.length > 0) {
        console.log(`\n❌ Subscribable Errors:`);
        for (const error of subscribableResult.errors) {
          console.log(`   - ${error.subscribable}: ${error.error}`);
        }
      }

      // Ensure output directory exists
      if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
      }

      console.log(`\n📝 Writing subscribable files to: ${options.output}`);

      for (const subResult of subscribableResult.results) {
        const outputFile = resolve(options.output, `${subResult.name}.sql`);
        writeFileSync(outputFile, subResult.sql, 'utf-8');
        console.log(`   ✓ ${subResult.name}.sql`);
      }
    }

    console.log(`\n✅ Compilation complete!\n`);
  } catch (error) {
    console.error(`\n❌ Compilation failed:`, error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// ============================================================================
// Migration Commands
// ============================================================================

async function runMigrateNew(args) {
  const migrationName = args[0];

  if (!migrationName) {
    console.error('Error: Migration name required');
    console.log('Usage: dzql migrate:new <name>');
    console.log('Example: dzql migrate:new add_user_avatars');
    process.exit(1);
  }

  // Create migrations directory if it doesn't exist
  const migrationsDir = './migrations';
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
  }

  // Find next migration number
  const fs = await import('fs/promises');
  const files = await fs.readdir(migrationsDir).catch(() => []);
  const existingNumbers = files
    .filter(f => /^\d{3}_/.test(f))
    .map(f => parseInt(f.substring(0, 3)))
    .filter(n => !isNaN(n));

  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  const paddedNumber = String(nextNumber).padStart(3, '0');
  const fileName = `${paddedNumber}_${migrationName}.sql`;
  const filePath = resolve(migrationsDir, fileName);

  if (existsSync(filePath)) {
    console.error(`Error: Migration ${fileName} already exists`);
    process.exit(1);
  }

  // Generate migration template
  // Note: No BEGIN/COMMIT - postgres.js handles transactions automatically
  const template = `-- ============================================================================
-- Migration ${paddedNumber}: ${migrationName.replace(/_/g, ' ')}
-- Generated: ${new Date().toISOString().split('T')[0]}
-- ============================================================================

-- Part 1: Schema Changes
-- ALTER TABLE example ADD COLUMN IF NOT EXISTS new_field TEXT;

-- Part 2: Drop Old DZQL Functions (if updating entity)
-- DROP FUNCTION IF EXISTS save_entity_name(INT, JSONB);
-- DROP FUNCTION IF EXISTS get_entity_name(INT, INT, TIMESTAMPTZ);
-- etc.

-- Part 3: Install New Compiled Functions
-- Compile your entities first: bun run compile
-- Then paste the compiled function SQL here from init_db/entity_name.sql

-- Part 4: Custom Functions (optional)
-- CREATE OR REPLACE FUNCTION my_custom_function(
--   p_user_id INT,
--   p_params JSONB
-- ) RETURNS JSONB AS $$
-- BEGIN
--   -- Your logic
--   RETURN jsonb_build_object('result', 'success');
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Part 5: Register Custom Functions (optional)
-- INSERT INTO dzql.registry (fn_regproc, description)
-- VALUES
--   ('my_custom_function'::regproc, 'Description of function')
-- ON CONFLICT DO NOTHING;

-- ============================================================================
-- Rollback (for migrate:down support)
-- ============================================================================
-- To support rollback, add reverse operations in comments:
--
-- ROLLBACK INSTRUCTIONS:
-- 1. Drop new functions
-- 2. Restore old functions
-- 3. Remove columns (if safe)
-- 4. Drop tables (if safe)
-- ============================================================================
`;

  writeFileSync(filePath, template, 'utf-8');

  console.log(`\n✅ Created migration: ${fileName}`);
  console.log(`📝 Edit: ${filePath}`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Update your entity definitions (entities/*.sql)`);
  console.log(`   2. Run: bun run compile (generates updated functions in init_db/)`);
  console.log(`   3. Copy compiled functions into migration file`);
  console.log(`   4. Test migration: psql $DATABASE_URL -f ${filePath}`);
  console.log(`   5. Apply to production: dzql migrate:up\n`);
}

async function runMigrateUp(args) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable not set');
    console.log('Set it to your PostgreSQL connection string:');
    console.log('  export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"');
    process.exit(1);
  }

  const migrationsDir = './migrations';
  if (!existsSync(migrationsDir)) {
    console.error(`Error: Migrations directory not found: ${migrationsDir}`);
    console.log('Create it with: dzql migrate:new <name>');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    console.log('🔌 Connected to database');

    // 1. Create migrations table
    await sql`
      CREATE TABLE IF NOT EXISTS dzql.migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 2. Get applied migrations
    const appliedRows = await sql`SELECT name, applied_at FROM dzql.migrations ORDER BY applied_at`;
    const appliedMigrations = new Set(appliedRows.map(row => row.name));

    if (appliedRows.length > 0) {
      console.log('\n📋 Already applied migrations:');
      appliedRows.forEach(row => {
        console.log(`   ✓ ${row.name} (${new Date(row.applied_at).toISOString()})`);
      });
    } else {
      console.log('\n📋 No migrations applied yet.');
    }

    // 3. Read migration files
    console.log('📂 Reading migrations from:', migrationsDir);

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Alphabetical order (001, 002, 003...)

    console.log(`\n📁 Found ${files.length} migration file(s)\n`);

    // 4. Apply new migrations
    let appliedCount = 0;
    for (const file of files) {
      if (appliedMigrations.has(file)) {
        console.log(`   ⏭  Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`\n🚀 Applying migration: ${file}`);
      const content = readFileSync(join(migrationsDir, file), 'utf-8');

      try {
        // Execute migration (it should have its own BEGIN/COMMIT)
        await sql.unsafe(content);

        // Record migration
        await sql`INSERT INTO dzql.migrations (name) VALUES (${file})`;

        console.log(`✅ Applied: ${file}`);
        appliedCount++;
      } catch (err) {
        console.error(`\n❌ Failed to apply ${file}:`);
        console.error(err.message);
        console.error('\n💡 Check your migration file for errors.');
        console.error('   If migration has BEGIN/COMMIT, it should have rolled back.');
        process.exit(1);
      }
    }

    if (appliedCount === 0) {
      console.log('\n✨ No new migrations to apply. Database is up to date.');
    } else {
      console.log(`\n✨ Successfully applied ${appliedCount} migration(s).`);
    }
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

async function runMigrateDown(args) {
  console.log('\n🚧 Migration:down command - Coming soon!');
  console.log('\nThis command will:');
  console.log('  1. Find last applied migration');
  console.log('  2. Parse rollback instructions');
  console.log('  3. Execute rollback');
  console.log('  4. Remove from dzql.migrations table\n');
}

async function runMigrateStatus(args) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const migrationsDir = './migrations';
  if (!existsSync(migrationsDir)) {
    console.log('📂 No migrations directory found');
    return;
  }

  const sql = postgres(databaseUrl);

  try {
    console.log('🔌 Connected to database\n');

    // Create migrations table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS dzql.migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Get applied migrations
    const appliedRows = await sql`SELECT name, applied_at FROM dzql.migrations ORDER BY applied_at`;
    const appliedMigrations = new Set(appliedRows.map(row => row.name));

    // Get all migration files
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log('📊 Migration Status\n');
    console.log(`Total migrations: ${files.length}`);
    console.log(`Applied: ${appliedRows.length}`);
    console.log(`Pending: ${files.length - appliedRows.length}\n`);

    if (appliedRows.length > 0) {
      console.log('✅ Applied Migrations:');
      appliedRows.forEach(row => {
        console.log(`   ${row.name} - ${new Date(row.applied_at).toLocaleString()}`);
      });
    }

    const pendingFiles = files.filter(f => !appliedMigrations.has(f));
    if (pendingFiles.length > 0) {
      console.log('\n⏳ Pending Migrations:');
      pendingFiles.forEach(file => {
        console.log(`   ${file}`);
      });
      console.log('\nRun "dzql migrate:up" to apply pending migrations.');
    } else {
      console.log('\n✨ Database is up to date.');
    }

    console.log();
  } catch (err) {
    console.error('❌ Failed to get migration status:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// ============================================================================
// Database Initialization
// ============================================================================

async function runDbInit(args) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable not set');
    console.log('Set it to your PostgreSQL connection string:');
    console.log('  export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"');
    process.exit(1);
  }

  console.log('\n🚀 DZQL Database Initialization\n');

  const sql = postgres(databaseUrl);

  try {
    console.log('🔌 Connected to database');

    // Read the core SQL file
    const coreSQL = readFileSync(
      new URL('../src/database/dzql-core.sql', import.meta.url),
      'utf-8'
    );

    console.log('📦 Applying DZQL core schema...');
    await sql.unsafe(coreSQL);

    // Check version
    const version = await sql`SELECT version FROM dzql.meta ORDER BY installed_at DESC LIMIT 1`;
    console.log(`✅ DZQL core initialized (v${version[0]?.version || 'unknown'})`);

    console.log(`
Next steps:
  1. Create your entity definitions (schema + DZQL registrations)
  2. Compile: dzql compile entities.sql -o compiled/
  3. Apply:  psql $DATABASE_URL -f compiled/*.sql

Example entity file (entities.sql):
  -- Schema
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT
  );

  -- DZQL Registration
  SELECT dzql.register_entity('users', 'name', ARRAY['name', 'email']);
`);

  } catch (err) {
    console.error('❌ Initialization failed:', err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
