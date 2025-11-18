#!/usr/bin/env bun
/**
 * DZQL Demo Server
 *
 * Minimal example server that serves demo.html and provides WebSocket functionality.
 * Run with: bun packages/dzql/src/index.js
 */

import { createServer } from './server/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to demo.html
const demoPath = join(__dirname, 'client/demo.html');

// Create DZQL server with demo route
const app = createServer({
  port: 3000,
  routes: {
    '/': async () => {
      const file = Bun.file(demoPath);
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' }
      });
    },
    '/demo': async () => {
      const file = Bun.file(demoPath);
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }
});

console.log('🚀 DZQL Demo Server running');
console.log('📝 Visit http://localhost:3000 to see the demo');
console.log('🔌 WebSocket available at ws://localhost:3000/ws');
