#!/usr/bin/env bun
/**
 * DZQL Compiler CLI
 * Command-line interface for compiling entity definitions
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { DZQLCompiler } from '../compiler.js';

const USAGE = `
DZQL Compiler - Transform entity definitions into PostgreSQL functions

Usage:
  dzql-compile <input-file> [options]

Options:
  -o, --output <dir>       Output directory (default: ./compiled)
  -w, --watch              Watch for changes and recompile
  -v, --verbose            Verbose output
  -h, --help               Show this help message

Examples:
  dzql-compile entities/venues.sql
  dzql-compile database/init_db/009_venues_domain.sql -o compiled/
  dzql-compile entities/*.sql -o dist/compiled/

Environment Variables:
  DZQL_COMPILER_VERBOSE    Enable verbose output
`;

class CLI {
  constructor() {
    this.args = process.argv.slice(2);
    this.options = {
      output: './compiled',
      watch: false,
      verbose: process.env.DZQL_COMPILER_VERBOSE === 'true'
    };
    this.compiler = new DZQLCompiler();
  }

  run() {
    this.parseArgs();

    if (this.options.help || this.args.length === 0) {
      console.log(USAGE);
      process.exit(0);
    }

    const inputFile = this.args[0];

    if (!existsSync(inputFile)) {
      console.error(`Error: File not found: ${inputFile}`);
      process.exit(1);
    }

    this.compileFile(inputFile);

    if (this.options.watch) {
      this.watchFile(inputFile);
    }
  }

  parseArgs() {
    for (let i = 0; i < this.args.length; i++) {
      const arg = this.args[i];

      switch (arg) {
        case '-o':
        case '--output':
          this.options.output = this.args[++i];
          break;

        case '-w':
        case '--watch':
          this.options.watch = true;
          break;

        case '-v':
        case '--verbose':
          this.options.verbose = true;
          break;

        case '-h':
        case '--help':
          this.options.help = true;
          break;
      }
    }
  }

  compileFile(inputFile) {
    try {
      console.log(`\n🔨 Compiling: ${inputFile}`);

      // Read input file
      const sqlContent = readFileSync(inputFile, 'utf-8');

      // Compile
      const result = this.compiler.compileFromSQL(sqlContent);

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
        this.writeOutputFiles(result.results);
      }

      console.log(`\n✅ Compilation complete!\n`);
    } catch (error) {
      console.error(`\n❌ Compilation failed:`, error.message);
      if (this.options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  writeOutputFiles(results) {
    // Ensure output directory exists
    if (!existsSync(this.options.output)) {
      mkdirSync(this.options.output, { recursive: true });
    }

    console.log(`\n📝 Writing compiled files to: ${this.options.output}`);

    const checksums = {};

    for (const result of results) {
      const outputFile = resolve(this.options.output, `${result.tableName}.sql`);

      // Write SQL file
      writeFileSync(outputFile, result.sql, 'utf-8');

      // Store checksum
      checksums[result.tableName] = {
        checksum: result.checksum,
        generatedAt: result.generatedAt,
        compilationTime: result.compilationTime
      };

      console.log(`   ✓ ${result.tableName}.sql (${result.checksum.substring(0, 8)}...)`);
    }

    // Write checksums file
    const checksumsFile = resolve(this.options.output, 'checksums.json');
    writeFileSync(checksumsFile, JSON.stringify(checksums, null, 2), 'utf-8');

    console.log(`   ✓ checksums.json`);
  }

  watchFile(inputFile) {
    console.log(`\n👀 Watching for changes...`);

    // TODO: Implement file watching
    console.log(`   (Watch mode not yet implemented)`);
  }
}

// Run CLI
const cli = new CLI();
cli.run();
