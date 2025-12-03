// Suppress logger output for CLI usage - MUST be set before any imports
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

import { sql, db } from "./db.js";

// Default user for CLI operations
const DEFAULT_USER_ID = 1;

/**
 * Discover available entities from dzql.entities table or compiled functions
 * @returns {Promise<Object>} Map of entity name to {label, searchable, description}
 */
async function discoverEntities() {
  // First try dzql.entities table (runtime mode)
  const result = await sql`
    SELECT table_name, label_field, searchable_fields
    FROM dzql.entities
    ORDER BY table_name
  `;

  const entities = {};

  if (result.length > 0) {
    // Runtime mode - use dzql.entities table
    for (const row of result) {
      const searchFields = row.searchable_fields?.join(", ") || "none";
      entities[row.table_name] = {
        label: row.label_field,
        searchable: row.searchable_fields || [],
        description: `Entity: ${row.table_name} (label: ${row.label_field}, searchable: ${searchFields})`,
      };
    }
  } else {
    // Compiled mode - discover from function names
    const functions = await sql`
      SELECT DISTINCT substring(proname from 'search_(.+)') as entity_name
      FROM pg_proc
      WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND proname LIKE 'search_%'
      AND substring(proname from 'search_(.+)') IS NOT NULL
      ORDER BY entity_name
    `;

    for (const row of functions) {
      const entityName = row.entity_name;
      entities[entityName] = {
        label: 'id',  // Default, since we can't know from functions alone
        searchable: [],
        description: `Entity: ${entityName} (compiled mode)`,
      };
    }
  }

  return entities;
}

/**
 * DZQL operations namespace - provides CLI-style access to DZQL operations
 *
 * Each method outputs JSON to console and calls sql.end() before returning,
 * making instances single-use. On error, methods call process.exit(1).
 *
 * Usage in tasks.js:
 * ```js
 * import { DzqlNamespace } from 'dzql/namespace';
 *
 * export class Tasks {
 *   constructor() {
 *     this.dzql = new DzqlNamespace();
 *   }
 * }
 * ```
 */
export class DzqlNamespace {
  /**
   * @param {number} [userId=1] - User ID for permission checks
   */
  constructor(userId = DEFAULT_USER_ID) {
    this.userId = userId;
  }

  /**
   * List all available entities
   * @returns {Promise<void>} Outputs JSON to console
   */
  async entities(c) {
    try {
      const entities = await discoverEntities();
      console.log(JSON.stringify({ success: true, entities }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }

  /**
   * Search an entity
   * @example invj dzql:search venues '{"query": "test"}'
   * @param {string} entity - Entity/table name to search
   * @param {string} [argsJson] - JSON string with search args (query, limit, offset, filters)
   */
  async search(c, entity, argsJson = "{}") {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invokej dzql.search <entity> '<json_args>'");
      console.error(
        'Example: invokej dzql.search organisations \'{"query": "test"}\'',
      );
      await sql.end();
      process.exit(1);
    }

    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Error: arguments must be valid JSON");
      await sql.end();
      process.exit(1);
    }

    try {
      const result = await db.api.search[entity](args, this.userId);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }

  /**
   * Get entity by ID
   * @example invj dzql:get venues '{"id": 1}'
   * @param {string} entity - Entity/table name
   * @param {string} [argsJson] - JSON string with {id: number}
   */
  async get(c, entity, argsJson = "{}") {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invokej dzql.get <entity> '<json_args>'");
      console.error("Example: invokej dzql.get venues '{\"id\": 1}'");
      await sql.end();
      process.exit(1);
    }

    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Error: arguments must be valid JSON");
      await sql.end();
      process.exit(1);
    }

    try {
      const result = await db.api.get[entity](args, this.userId);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }

  /**
   * Save (create or update) entity
   * @example invj dzql:save venues '{"name": "New Venue", "org_id": 1}'
   * @param {string} entity - Entity/table name
   * @param {string} [argsJson] - JSON string with entity data (include id to update, omit to create)
   */
  async save(c, entity, argsJson = "{}") {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invokej dzql.save <entity> '<json_args>'");
      console.error(
        'Example: invokej dzql.save venues \'{"name": "Test Venue", "org_id": 1}\'',
      );
      await sql.end();
      process.exit(1);
    }

    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Error: arguments must be valid JSON");
      await sql.end();
      process.exit(1);
    }

    try {
      const result = await db.api.save[entity](args, this.userId);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }

  /**
   * Delete entity by ID
   * @example invj dzql:delete venues '{"id": 1}'
   * @param {string} entity - Entity/table name
   * @param {string} [argsJson] - JSON string with {id: number}
   */
  async delete(c, entity, argsJson = "{}") {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invokej dzql.delete <entity> '<json_args>'");
      console.error("Example: invokej dzql.delete venues '{\"id\": 1}'");
      await sql.end();
      process.exit(1);
    }

    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Error: arguments must be valid JSON");
      await sql.end();
      process.exit(1);
    }

    try {
      const result = await db.api.delete[entity](args, this.userId);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }

  /**
   * Lookup entity (for dropdowns/autocomplete)
   * @example invj dzql:lookup organisations '{"query": "acme"}'
   * @param {string} entity - Entity/table name
   * @param {string} [argsJson] - JSON string with {query: string, limit?: number}
   */
  async lookup(c, entity, argsJson = "{}") {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invokej dzql.lookup <entity> '<json_args>'");
      console.error(
        'Example: invokej dzql.lookup organisations \'{"query": "acme"}\'',
      );
      await sql.end();
      process.exit(1);
    }

    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Error: arguments must be valid JSON");
      await sql.end();
      process.exit(1);
    }

    try {
      const result = await db.api.lookup[entity](args, this.userId);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await sql.end();
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error.message }, null, 2),
      );
      await sql.end();
      process.exit(1);
    }
  }
}
