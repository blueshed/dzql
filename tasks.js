import { sql, db } from "./packages/dzql/src/server/db.js";

// Default user for CLI operations (same as MCP server default)
const DEFAULT_USER_ID = 1;

/**
 * Discover available entities from dzql.entities table
 */
async function discoverEntities() {
  const result = await sql`
    SELECT table_name, label_field, searchable_fields
    FROM dzql.entities
    ORDER BY table_name
  `;

  const entities = {};
  for (const row of result) {
    const searchFields = row.searchable_fields?.join(", ") || "none";
    entities[row.table_name] = {
      label: row.label_field,
      searchable: row.searchable_fields || [],
      description: `Entity: ${row.table_name} (label: ${row.label_field}, searchable: ${searchFields})`,
    };
  }

  return entities;
}

/**
 * DZQL operations namespace - mirrors MCP server functionality
 */
class DzqlNamespace {
  constructor(userId = DEFAULT_USER_ID) {
    this.userId = userId;
  }

  /** List all available entities */
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

  /** Search an entity */
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

  /** Get entity by ID */
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

  /** Save (create or update) entity */
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

  /** Delete entity by ID */
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

  /** Lookup entity (for dropdowns/autocomplete) */
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

/**
 * Main tasks class for invokej
 */
export class Tasks {
  constructor() {
    this.dzql = new DzqlNamespace();
  }
}
