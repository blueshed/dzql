/**
 * DZQL Namespace for invokej integration
 *
 * Provides CLI-style access to DZQL operations via the compiled manifest.
 * Each method outputs JSON to console and closes the connection before returning.
 *
 * Setup - add to your tasks.js:
 * ```js
 * import { DzqlNamespace } from 'dzql/namespace';
 *
 * export class Tasks {
 *   constructor() {
 *     this.dzql = new DzqlNamespace();
 *   }
 * }
 * ```
 *
 * Available Commands:
 *
 * Discovery:
 *   invj dzql:entities                              # List all entities
 *   invj dzql:subscribables                         # List all subscribables
 *   invj dzql:functions                             # List all manifest functions
 *
 * Entity CRUD:
 *   invj dzql:search venues '{"query": "test"}'     # Search with filters
 *   invj dzql:get venues '{"id": 1}'                # Get by primary key
 *   invj dzql:save venues '{"name": "New", "org_id": 1}'  # Create (no id)
 *   invj dzql:save venues '{"id": 1, "name": "Updated"}'  # Update (with id)
 *   invj dzql:delete venues '{"id": 1}'             # Delete by primary key
 *   invj dzql:lookup venues '{"query": "test"}'     # Lookup for dropdowns
 *
 * Subscribables:
 *   invj dzql:subscribe venue_detail '{"venue_id": 1}'  # Get snapshot
 *
 * Ad-hoc Function Calls:
 *   invj dzql:call login_user '{"email": "x", "password": "y"}'
 *   invj dzql:call register_user '{"email": "x", "password": "y"}'
 *   invj dzql:call get_venue_detail '{"venue_id": 1}'
 *   invj dzql:call save_venues '{"name": "Test", "org_id": 1}'
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (default: postgres://localhost:5432/dzql)
 *
 * Requirements:
 *   - Run 'dzql compile' first to generate dist/runtime/manifest.json
 */

import postgres from "postgres";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { Manifest, FunctionDef } from "../cli/codegen/manifest.js";

// Default user for CLI operations
const DEFAULT_USER_ID = 1;

/**
 * Load manifest from MANIFEST_PATH env var or default locations
 */
function loadManifestFromDisk(): Manifest {
  // First check MANIFEST_PATH env var (like the runtime does)
  const envPath = process.env.MANIFEST_PATH;
  if (envPath) {
    const resolvedPath = resolve(process.cwd(), envPath);
    if (existsSync(resolvedPath)) {
      const content = readFileSync(resolvedPath, "utf-8");
      return JSON.parse(content);
    }
    throw new Error(
      `Manifest not found at MANIFEST_PATH: ${resolvedPath}`
    );
  }

  // Fall back to default paths
  const paths = [
    join(process.cwd(), "dist/runtime/manifest.json"),
    join(process.cwd(), "generated/runtime/manifest.json"),
  ];

  for (const path of paths) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content);
    }
  }

  throw new Error(
    "Manifest not found. Set MANIFEST_PATH env var or run 'dzql compile' to generate dist/runtime/manifest.json"
  );
}

/**
 * Discover available entities from the manifest
 */
function discoverEntities(manifest: Manifest): Record<string, { label: string; description: string }> {
  const entities: Record<string, { label: string; description: string }> = {};

  for (const [name, entity] of Object.entries(manifest.entities || {})) {
    entities[name] = {
      label: (entity as any).labelField || "id",
      description: `Entity: ${name} (compiled mode)`,
    };
  }

  return entities;
}

/**
 * Discover available subscribables from the manifest
 */
function discoverSubscribables(manifest: Manifest): Record<string, { params: Record<string, string>; description: string }> {
  const subscribables: Record<string, { params: Record<string, string>; description: string }> = {};

  for (const [name, sub] of Object.entries(manifest.subscribables || {})) {
    subscribables[name] = {
      params: (sub as any).params || {},
      description: `Subscribable: ${name}`,
    };
  }

  return subscribables;
}

/**
 * DZQL operations namespace for invokej
 */
export class DzqlNamespace {
  private userId: number;
  private sql: postgres.Sql | null = null;
  private manifest: Manifest | null = null;

  constructor(userId: number = DEFAULT_USER_ID) {
    this.userId = userId;
  }

  private async init(): Promise<{ sql: postgres.Sql; manifest: Manifest }> {
    if (!this.sql) {
      const connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/dzql";
      this.sql = postgres(connectionString, {
        max: 1,
        idle_timeout: 5,
        onnotice: () => {},
      });
    }
    if (!this.manifest) {
      this.manifest = loadManifestFromDisk();
    }
    return { sql: this.sql, manifest: this.manifest };
  }

  private async cleanup(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
  }

  private async executeFunction(
    fnName: string,
    params: any
  ): Promise<any> {
    const { sql, manifest } = await this.init();

    const fnDef = manifest.functions[fnName];
    if (!fnDef) {
      throw new Error(`Function '${fnName}' not found in manifest`);
    }

    const qualifiedName = `${fnDef.schema}.${fnDef.name}`;

    // Build SQL params based on function signature
    const dbParams: any[] = [];
    const sqlArgs: string[] = [];

    for (const arg of fnDef.args) {
      if (arg === "p_user_id") {
        dbParams.push(this.userId);
        sqlArgs.push(`$${dbParams.length}`);
      } else if (["p_data", "p_pk", "p_query", "p_params"].includes(arg)) {
        // Pass the object directly - postgres.js will handle JSON serialization
        dbParams.push(params);
        sqlArgs.push(`$${dbParams.length}::jsonb`);
      } else {
        dbParams.push(null);
        sqlArgs.push(`$${dbParams.length}`);
      }
    }

    const query = `SELECT ${qualifiedName}(${sqlArgs.join(", ")}) as result`;
    const rows = await sql.unsafe(query, dbParams);
    return rows[0]?.result;
  }

  /**
   * List all available entities
   */
  async entities(_context?: any): Promise<void> {
    try {
      const { manifest } = await this.init();
      const entities = discoverEntities(manifest);
      console.log(JSON.stringify({ success: true, entities }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * List all available subscribables
   */
  async subscribables(_context?: any): Promise<void> {
    try {
      const { manifest } = await this.init();
      const subscribables = discoverSubscribables(manifest);
      console.log(JSON.stringify({ success: true, subscribables }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Search an entity
   * @example invj dzql:search venues '{"query": "test"}'
   */
  async search(_context: any, entity?: string, argsJson: string = "{}"): Promise<void> {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invj dzql:search <entity> '<json_args>'");
      console.error('Example: invj dzql:search venues \'{"query": "test"}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`search_${entity}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Get entity by ID
   * @example invj dzql:get venues '{"id": 1}'
   */
  async get(_context: any, entity?: string, argsJson: string = "{}"): Promise<void> {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invj dzql:get <entity> '<json_args>'");
      console.error('Example: invj dzql:get venues \'{"id": 1}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`get_${entity}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Save (create or update) entity
   * @example invj dzql:save venues '{"name": "New Venue", "org_id": 1}'
   */
  async save(_context: any, entity?: string, argsJson: string = "{}"): Promise<void> {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invj dzql:save <entity> '<json_args>'");
      console.error('Example: invj dzql:save venues \'{"name": "Test Venue", "org_id": 1}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`save_${entity}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Delete entity by ID
   * @example invj dzql:delete venues '{"id": 1}'
   */
  async delete(_context: any, entity?: string, argsJson: string = "{}"): Promise<void> {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invj dzql:delete <entity> '<json_args>'");
      console.error('Example: invj dzql:delete venues \'{"id": 1}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`delete_${entity}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Lookup entity (for dropdowns/autocomplete)
   * @example invj dzql:lookup organisations '{"query": "acme"}'
   */
  async lookup(_context: any, entity?: string, argsJson: string = "{}"): Promise<void> {
    if (!entity) {
      console.error("Error: entity name required");
      console.error("Usage: invj dzql:lookup <entity> '<json_args>'");
      console.error('Example: invj dzql:lookup organisations \'{"query": "acme"}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`lookup_${entity}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Get subscribable snapshot
   * @example invj dzql:subscribe venue_detail '{"venue_id": 1}'
   */
  async subscribe(_context: any, name?: string, argsJson: string = "{}"): Promise<void> {
    if (!name) {
      console.error("Error: subscribable name required");
      console.error("Usage: invj dzql:subscribe <name> '<json_args>'");
      console.error('Example: invj dzql:subscribe venue_detail \'{"venue_id": 1}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(`get_${name}`, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Call any function in the manifest by name
   * @example invj dzql:call login_user '{"email": "test@example.com", "password": "secret"}'
   * @example invj dzql:call get_venue_detail '{"venue_id": 1}'
   */
  async call(_context: any, funcName?: string, argsJson: string = "{}"): Promise<void> {
    if (!funcName) {
      console.error("Error: function name required");
      console.error("Usage: invj dzql:call <function_name> '<json_args>'");
      console.error('Example: invj dzql:call login_user \'{"email": "test@example.com", "password": "secret"}\'');
      console.error('Example: invj dzql:call get_venue_detail \'{"venue_id": 1}\'');
      await this.cleanup();
      process.exit(1);
    }

    let args: any;
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error("Error: arguments must be valid JSON");
      await this.cleanup();
      process.exit(1);
    }

    try {
      const result = await this.executeFunction(funcName, args);
      console.log(JSON.stringify({ success: true, result }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * List all available functions in the manifest
   * @example invj dzql:functions
   */
  async functions(_context?: any): Promise<void> {
    try {
      const { manifest } = await this.init();
      const functions: Record<string, { args: string[]; returnType: string }> = {};

      for (const [name, fn] of Object.entries(manifest.functions)) {
        functions[name] = {
          args: fn.args,
          returnType: fn.returnType,
        };
      }

      console.log(JSON.stringify({ success: true, functions }, null, 2));
      await this.cleanup();
    } catch (error: any) {
      console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
      await this.cleanup();
      process.exit(1);
    }
  }
}
