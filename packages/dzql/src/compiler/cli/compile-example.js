#!/usr/bin/env bun

import { readFileSync } from 'fs';
import { compileSubscribablesFromSQL } from '../compiler.js';

const sqlContent = readFileSync('./examples/subscribables/venue_detail_simple.sql', 'utf-8');

console.log('Compiling subscribable...\n');

try {
  const result = compileSubscribablesFromSQL(sqlContent);

  console.log('Summary:', result.summary);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(err => {
      console.log(`  ${err.subscribable}: ${err.error}`);
    });
  }

  if (result.results.length > 0) {
    const compiled = result.results[0];
    console.log(`\n✓ Compiled '${compiled.name}' successfully!`);
    console.log(`  Checksum: ${compiled.checksum.substring(0, 16)}...`);
    console.log(`  Time: ${compiled.compilationTime}ms`);
    console.log('\nGenerated SQL:\n');
    console.log(compiled.sql);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
