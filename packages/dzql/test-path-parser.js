#!/usr/bin/env node

import { PathParser } from './src/compiler/parser/path-parser.js';

const parser = new PathParser();

const testPath = '@org_id->acts_for[org_id=$]{active}.user_id';

console.log('Parsing path:', testPath);
console.log('');

try {
  const ast = parser.parse(testPath);
  console.log('AST:', JSON.stringify(ast, null, 2));
} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
}
