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
