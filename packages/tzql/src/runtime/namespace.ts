/**
 * DZQL Namespace for invoket integration
 *
 * Provides CLI-style access to DZQL operations via the compiled manifest.
 * Each method outputs JSON to console and closes the connection before returning.
 *
 * Setup - add to your tasks.ts:
 * ```ts
 * import { Context } from "invoket/context";
 * import { DzqlNamespace } from "dzql/namespace";
 *
 * export class Tasks {
 *   dzql = new DzqlNamespace();
 * }
 * ```
 *
 * Available Commands:
 *
 * Discovery:
 *   invt dzql:entities                              # List all entities
 *   invt dzql:subscribables                         # List all subscribables
 *   invt dzql:functions                             # List all manifest functions
 *
 * Entity CRUD:
 *   invt dzql:search venues '{"query": "test"}'     # Search with filters
 *   invt dzql:get venues '{"id": 1}'                # Get by primary key
 *   invt dzql:save venues '{"name": "New", "org_id": 1}'  # Create (no id)
 *   invt dzql:save venues '{"id": 1, "name": "Updated"}'  # Update (with id)
 *   invt dzql:delete venues '{"id": 1}'             # Delete by primary key
 *   invt dzql:lookup venues '{"query": "test"}'     # Lookup for dropdowns
 *
 * Subscribables:
 *   invt dzql:subscribe venue_detail '{"venue_id": 1}'  # Get snapshot
 *
 * Ad-hoc Function Calls:
 *   invt dzql:call login_user '{"email": "x", "password": "y"}'
 *   invt dzql:call register_user '{"email": "x", "password": "y"}'
 *   invt dzql:call get_venue_detail '{"venue_id": 1}'
 *   invt dzql:call save_venues '{"name": "Test", "org_id": 1}'
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

/** Context interface compatible with invoket - kept minimal to avoid dependency */
export interface Context {
  cwd: string;
  run(command: string, options?: { echo?: boolean }): Promise<unknown>;
}

/** Query parameters for search operations */
export interface SearchParams {
  query?: string;
  filters?: Record<string, unknown>;
  sort_field?: string;
  sort_order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Primary key for get/delete operations */
export interface PkParams {
  id?: number;
  [key: string]: unknown;
}

/** Generic params for any operation */
export interface CallParams {
  [key: string]: unknown;
}

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
 * DZQL operations namespace for invoket
 *
 * Use with invoket task runner:
 * ```ts
 * import { DzqlNamespace } from "dzql/namespace";
 *
 * export class Tasks {
 *   dzql = new DzqlNamespace();
 * }
 * ```
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

    // Handle search/lookup functions that return SETOF jsonb (array of rows)
    if (fnName.startsWith('search_') || fnName.startsWith('lookup_')) {
      return rows.map((r: any) => r.result).filter((i: any) => i !== null);
    }

    return rows[0]?.result;
  }

  /**
   * List all available entities
   * @example invt dzql:entities
   */
  async entities(c: Context): Promise<void> {
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
   * @example invt dzql:subscribables
   */
  async subscribables(c: Context): Promise<void> {
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
   * @example invt dzql:search venues '{"query": "test"}'
   */
  async search(c: Context, entity: string, params: SearchParams = {}): Promise<void> {
    try {
      const result = await this.executeFunction(`search_${entity}`, params);
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
   * @example invt dzql:get venues '{"id": 1}'
   */
  async get(c: Context, entity: string, pk: PkParams): Promise<void> {
    try {
      const result = await this.executeFunction(`get_${entity}`, pk);
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
   * @example invt dzql:save venues '{"name": "New Venue", "org_id": 1}'
   */
  async save(c: Context, entity: string, data: CallParams): Promise<void> {
    try {
      const result = await this.executeFunction(`save_${entity}`, data);
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
   * @example invt dzql:delete venues '{"id": 1}'
   */
  async delete(c: Context, entity: string, pk: PkParams): Promise<void> {
    try {
      const result = await this.executeFunction(`delete_${entity}`, pk);
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
   * @example invt dzql:lookup organisations '{"query": "acme"}'
   */
  async lookup(c: Context, entity: string, params: SearchParams = {}): Promise<void> {
    try {
      const result = await this.executeFunction(`lookup_${entity}`, params);
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
   * @example invt dzql:subscribe venue_detail '{"venue_id": 1}'
   */
  async subscribe(c: Context, name: string, params: CallParams = {}): Promise<void> {
    try {
      const result = await this.executeFunction(`get_${name}`, params);
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
   * @example invt dzql:call login_user '{"email": "test@example.com", "password": "secret"}'
   * @example invt dzql:call get_venue_detail '{"venue_id": 1}'
   */
  async call(c: Context, funcName: string, params: CallParams = {}): Promise<void> {
    try {
      const result = await this.executeFunction(funcName, params);
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
   * @example invt dzql:functions
   */
  async functions(c: Context): Promise<void> {
    try {
      const { manifest } = await this.init();
      const functions: Record<string, { schema: string; args: string[] }> = {};

      for (const [name, fn] of Object.entries(manifest.functions)) {
        functions[name] = {
          schema: fn.schema,
          args: fn.args,
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
