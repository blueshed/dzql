#!/usr/bin/env node

/**
 * Compile subscribable and output SQL only (for piping to psql)
 */

import { readFileSync } from 'fs';
import { compileSubscribablesFromSQL } from './src/compiler/compiler.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: compile-subscribable.js <sql-file>');
  process.exit(1);
}

const sqlFile = args[0];

try {
  const sqlContent = readFileSync(sqlFile, 'utf-8');
  const result = compileSubscribablesFromSQL(sqlContent);

  if (result.errors.length > 0) {
    console.error('Compilation errors:');
    result.errors.forEach(err => {
      console.error(`  ${err.subscribable}: ${err.error}`);
    });
    process.exit(1);
  }

  if (result.results.length === 0) {
    console.error('No subscribables found in', sqlFile);
    process.exit(1);
  }

  // Output just the SQL
  for (const compiled of result.results) {
    console.log(compiled.sql);
    console.log(''); // Blank line between subscribables
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
