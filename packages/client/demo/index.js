#!/usr/bin/env bun
/**
 * DZQL Demo Server
 *
 * Minimal example server that serves demo.html and provides WebSocket functionality.
 * Run with: bun packages/dzql/src/index.js
 */

import { createServer } from 'dzql/server';
import demo from './demo.html';

// Create DZQL server with demo route
const app = createServer({
  port: 3000,
  routes: {
    '/': demo
  }
});

console.log('🚀 DZQL Demo Server running');
console.log('📝 Visit http://localhost:3000 to see the demo');
console.log('🔌 WebSocket available at ws://localhost:3000/ws');
