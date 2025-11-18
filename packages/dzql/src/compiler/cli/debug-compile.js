#!/usr/bin/env bun

/**
 * Test script for subscribable compilation
 */

import { readFileSync } from 'fs';
import { compileSubscribablesFromSQL } from './src/compiler/compiler.js';

// Read the example subscribable
const sqlContent = readFileSync('./examples/subscribables/venue_detail_subscribable.sql', 'utf-8');

console.log('Compiling subscribable...\n');

try {
  const result = compileSubscribablesFromSQL(sqlContent);

  console.log('Compilation Summary:');
  console.log(`  Total: ${result.summary.total}`);
  console.log(`  Successful: ${result.summary.successful}`);
  console.log(`  Failed: ${result.summary.failed}\n`);

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach(err => {
      console.log(`  - ${err.subscribable}: ${err.error}`);
    });
    console.log('');
  }

  if (result.results.length > 0) {
    const compiled = result.results[0];
    console.log(`Generated SQL for '${compiled.name}':`);
    console.log('='.repeat(80));
    console.log(compiled.sql);
    console.log('='.repeat(80));
    console.log(`\nChecksum: ${compiled.checksum}`);
    console.log(`Compilation time: ${compiled.compilationTime}ms`);
  }
} catch (error) {
  console.error('Compilation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
