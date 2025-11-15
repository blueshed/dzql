/**
 * Streaks API Functions
 *
 * This file is for custom Bun functions that wrap business logic NOT suitable
 * for PostgreSQL stored functions.
 *
 * Use cases for Bun API wrappers:
 * - External API calls (email services, SMS, webhooks, etc.)
 * - npm package usage (image processing, PDF generation, etc.)
 * - File system operations
 * - Complex JavaScript-specific logic
 *
 * PostgreSQL stored functions (like create_share_connection, close_share_connection)
 * are automatically exposed through dzql's auto-discovery mechanism via db.api.*
 * and DO NOT need JavaScript wrappers.
 *
 * See: packages/dzql/src/server/db.js for auto-discovery implementation
 */
 import { sql } from "dzql";
