#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { DZQLCompiler } from '../src/compiler/compiler.js';

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
  case 'db:up':
    console.log('🚧 Database commands coming soon');
    break;
  case 'compile':
    await runCompile(args);
    break;
  case '--version':
  case '-v':
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    console.log(pkg.default.version);
    break;
  default:
    console.log(`
DZQL CLI

Usage:
  dzql create <app-name>     Create a new DZQL application
  dzql dev                   Start development server
  dzql db:up                 Start PostgreSQL database
  dzql db:down               Stop PostgreSQL database
  dzql compile <input>       Compile entity definitions to SQL
  dzql --version             Show version

Examples:
  dzql create my-venue-app
  dzql dev
  dzql compile database/init_db/009_venues_domain.sql -o compiled/
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
      const coreSQL = `-- DZQL Core Schema and Events System

CREATE SCHEMA IF NOT EXISTS dzql;

-- Event Audit Table for real-time notifications
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL,              -- 'insert', 'update', 'delete'
  pk jsonb NOT NULL,             -- primary key of affected record
  before jsonb,                  -- old values (NULL for insert)
  after jsonb,                   -- new values (NULL for delete)
  user_id int,                   -- who made the change
  notify_users int[],            -- who should be notified
  at timestamptz DEFAULT now()   -- when the change occurred
);

CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS dzql_events_event_id_idx ON dzql.events (event_id);

-- Event notification trigger - sends real-time notifications via pg_notify
CREATE OR REPLACE FUNCTION dzql.notify_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('dzql', jsonb_build_object(
    'event_id', NEW.event_id,
    'table', NEW.table_name,
    'op', NEW.op,
    'pk', NEW.pk,
    'data', COALESCE(NEW.after, NEW.before),
    'before', NEW.before,
    'after', NEW.after,
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
      const authSQL = `-- Authentication Functions
-- Required for DZQL WebSocket server

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Register new user
CREATE OR REPLACE FUNCTION register_user(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id INT;
  salt TEXT;
  hash TEXT;
BEGIN
  -- Generate salt and hash password
  salt := gen_salt('bf', 10);
  hash := crypt(p_password, salt);

  -- Insert user (assumes users table has: id, email, name, password_hash)
  INSERT INTO users (email, name, password_hash)
  VALUES (p_email, split_part(p_email, '@', 1), hash)
  RETURNING id INTO user_id;

  RETURN _profile(user_id);
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
  user_record RECORD;
BEGIN
  SELECT id, email, name, password_hash
  INTO user_record
  FROM users
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  IF NOT (user_record.password_hash = crypt(p_password, user_record.password_hash)) THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  RETURN _profile(user_record.id);
END $$;

-- Get user profile (private function, called after login/register)
CREATE OR REPLACE FUNCTION _profile(p_user_id INT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'user_id', id,
    'email', email,
    'name', name,
    'created_at', created_at
  )
  FROM users
  WHERE id = p_user_id;
$$;
`;

      writeFileSync(resolve(options.output, '002_auth.sql'), authSQL, 'utf-8');
      console.log(`   ✓ 002_auth.sql`);

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
