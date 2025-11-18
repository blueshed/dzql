#!/usr/bin/env bun

/**
 * Test script for subscribable parsing (debug)
 */

import { readFileSync } from 'fs';
import { SubscribableParser } from './src/compiler/parser/subscribable-parser.js';

// Read the example subscribable
const sqlContent = readFileSync('./examples/subscribables/venue_detail_subscribable.sql', 'utf-8');

console.log('Parsing subscribable...\n');

const parser = new SubscribableParser();
const subscribables = parser.parseAllFromSQL(sqlContent);

console.log('Found', subscribables.length, 'subscribables\n');

for (const sub of subscribables) {
  console.log('Subscribable:', sub.name);
  console.log('Root Entity:', sub.rootEntity);
  console.log('Permission Paths:', JSON.stringify(sub.permissionPaths, null, 2));
  console.log('Param Schema:', JSON.stringify(sub.paramSchema, null, 2));
  console.log('Relations:', JSON.stringify(sub.relations, null, 2));
}
