// ZeroQL Framework - Main Entry Point
export { default as createServer } from './server/index.js';

// Re-export client utilities
export { WebSocketManager, useWs } from './client/ws.js';

// Re-export database utilities for tests and custom functions
export { sql, listen_sql, db } from './server/db.js';
export { createWebSocketHandlers, verify_jwt_token } from './server/ws.js';
