/**
 * Domain -> SQL compilation pipeline.
 *
 * The CLI writes these strings to migration files; tests load the same strings
 * into Postgres, so they exercise exactly the SQL the compiler produces.
 */
import type { DomainConfig } from "../shared/ir.js";
import { analyzeDomain } from "./compiler/analyzer.js";
import { generateIR } from "./compiler/ir.js";
import { generateCoreSQL, generateAuthSQL, generateEntitySQL, generateSchemaSQL } from "./codegen/sql.js";
import { generateSubscribableSQL, generateComputeAffectedKeysFunction } from "./codegen/subscribable_sql.js";

export interface CompiledDomain {
  ir: any;
  coreSQL: string;
  /** Tables, CRUD functions, auth functions and custom functions */
  schemaSQL: string;
  /** Subscribable functions plus compute_affected_keys */
  subscribableSQL: string;
  customFunctionCount: number;
}

export class DomainValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Domain validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    this.name = 'DomainValidationError';
  }
}

export function compileDomain(domain: DomainConfig): CompiledDomain {
  const errors = analyzeDomain(domain);
  if (errors.length > 0) {
    throw new DomainValidationError(errors);
  }

  const ir = generateIR(domain);
  const coreSQL = generateCoreSQL();

  // Topologically sort entities by FK dependencies
  // Entities must be created before entities that reference them
  // Also detects circular FKs that need deferred constraint creation
  const { sorted: sortedEntityNames, circularFKs } = topologicalSortEntities(ir.entities);

  // Build set of circular FK columns for stripping during schema generation
  const circularFKSet = new Set(circularFKs.map(fk => `${fk.table}.${fk.column}`));

  const entitySQL: string[] = [];
  for (const name of sortedEntityNames) {
    const entityIR = ir.entities[name];
    // Pass circular FK info so schema generation can strip those constraints
    entitySQL.push(generateSchemaSQL(name, entityIR, circularFKSet));
    // Skip CRUD generation for unmanaged entities (e.g., junction tables)
    if (entityIR.managed !== false) {
      entitySQL.push(generateEntitySQL(name, entityIR, ir.entities));
    } else {
      console.log(`[Compiler] Skipping CRUD for unmanaged entity: ${name}`);
    }
  }

  // Add deferred FK constraints at the end (for circular dependencies)
  if (circularFKs.length > 0) {
    entitySQL.push(generateDeferredFKConstraints(circularFKs));
  }

  // Generate subscribable SQL functions
  const subscribableSQL: string[] = [];
  const subscribableNames = Object.keys(ir.subscribables);
  for (const [name, subIR] of Object.entries(ir.subscribables)) {
    console.log(`[Compiler] Generating SQL for subscribable: ${name}`);
    subscribableSQL.push(generateSubscribableSQL(name, subIR as any, ir.entities));
  }
  // Generate central compute_affected_keys function that aggregates all subscribables
  subscribableSQL.push(generateComputeAffectedKeysFunction(subscribableNames));

  // Collect custom functions SQL
  const customFunctionSQL: string[] = [];
  for (const fn of ir.customFunctions) {
    console.log(`[Compiler] Adding custom function: ${fn.name}`);
    customFunctionSQL.push(fn.sql);
  }

  // Combine entity SQL with auth functions and custom functions
  // Auth functions must come after schema (they depend on users table)
  // Columns a client may set at registration: those declared in
  // auth.registerParams (beyond the built-in email/password/options), else
  // just the users label field. Everything else is rejected at sign-up.
  const usersEntity = ir.entities.users;
  const declaredRegisterable = Object.keys(ir.auth?.registerParams || {})
    .filter((k) => !["email", "password", "options"].includes(k));
  const registerableColumns = declaredRegisterable.length > 0
    ? declaredRegisterable
    : (usersEntity && usersEntity.labelField && usersEntity.labelField !== "id"
        ? [usersEntity.labelField]
        : []);
  const authSQL = generateAuthSQL(registerableColumns);
  let schemaSQL = entitySQL.join('\n');
  schemaSQL += '\n\n-- Auth Functions\n' + authSQL;
  if (customFunctionSQL.length > 0) {
    schemaSQL += '\n\n-- Custom Functions\n' + customFunctionSQL.join('\n\n');
  }

  return {
    ir,
    coreSQL,
    schemaSQL,
    subscribableSQL: subscribableSQL.join('\n\n'),
    customFunctionCount: customFunctionSQL.length,
  };
}

/** FK info for dependency analysis */
interface FKInfo {
  table: string;
  column: string;
  referencedTable: string;
  fullConstraint: string; // e.g., "int NOT NULL REFERENCES users(id)"
}

/** Result of topological sort with cycle detection */
interface SortResult {
  sorted: string[];
  circularFKs: FKInfo[];
}

/**
 * Topologically sort entities based on FK dependencies.
 * Entities that are referenced by others come first.
 * Uses Kahn's algorithm for topological sorting.
 * Returns both sorted order and any circular FK constraints that need deferred creation.
 */
function topologicalSortEntities(entities: Record<string, any>): SortResult {
  const entityNames = Object.keys(entities);

  // Build dependency graph: entity -> entities it depends on (references)
  const dependencies: Record<string, Set<string>> = {};
  const dependents: Record<string, Set<string>> = {};

  // Track all FK info for cycle detection
  const allFKs: FKInfo[] = [];

  for (const name of entityNames) {
    dependencies[name] = new Set();
    dependents[name] = new Set();
  }

  // Parse REFERENCES from column types
  for (const name of entityNames) {
    const entity = entities[name];
    for (const col of entity.columns || []) {
      const match = col.type?.match(/REFERENCES\s+(\w+)/i);
      if (match) {
        const referencedEntity = match[1];
        // Only track dependencies to entities we're managing
        if (entityNames.includes(referencedEntity)) {
          dependencies[name].add(referencedEntity);
          dependents[referencedEntity].add(name);
          allFKs.push({
            table: name,
            column: col.name,
            referencedTable: referencedEntity,
            fullConstraint: col.type
          });
        }
      }
    }
  }

  // Kahn's algorithm
  const result: string[] = [];
  const noIncoming: string[] = [];
  const remainingDeps: Record<string, Set<string>> = {};

  // Copy dependencies for mutation
  for (const name of entityNames) {
    remainingDeps[name] = new Set(dependencies[name]);
  }

  // Find entities with no dependencies (no incoming edges)
  for (const name of entityNames) {
    if (remainingDeps[name].size === 0) {
      noIncoming.push(name);
    }
  }

  while (noIncoming.length > 0) {
    const node = noIncoming.shift()!;
    result.push(node);

    // Remove this node from the graph
    for (const dependent of dependents[node]) {
      remainingDeps[dependent].delete(node);
      if (remainingDeps[dependent].size === 0) {
        noIncoming.push(dependent);
      }
    }
  }

  // Detect circular FKs
  const circularFKs: FKInfo[] = [];
  if (result.length !== entityNames.length) {
    const cycleEntities = new Set(entityNames.filter(n => !result.includes(n)));
    console.warn(`[Compiler] Warning: Circular FK dependencies detected among: ${[...cycleEntities].join(', ')}`);

    // Find FKs that are part of the cycle - these need deferred creation
    for (const fk of allFKs) {
      if (cycleEntities.has(fk.table) && cycleEntities.has(fk.referencedTable)) {
        circularFKs.push(fk);
        console.log(`[Compiler] Deferring circular FK: ${fk.table}.${fk.column} -> ${fk.referencedTable}`);
      }
    }

    // Add remaining entities (cycle members) to result
    result.push(...cycleEntities);
  }

  return { sorted: result, circularFKs };
}

/**
 * Generate ALTER TABLE statements for deferred circular FK constraints.
 */
function generateDeferredFKConstraints(circularFKs: FKInfo[]): string {
  if (circularFKs.length === 0) return '';

  const statements: string[] = [
    '\n-- === DEFERRED FK CONSTRAINTS (for circular dependencies) ===\n'
  ];

  for (const fk of circularFKs) {
    // Extract the REFERENCES part from the full constraint
    const refMatch = fk.fullConstraint.match(/REFERENCES\s+(\w+)(\([^)]+\))?(\s+ON\s+.+)?/i);
    if (refMatch) {
      const targetTable = refMatch[1];
      const targetCol = refMatch[2] || '(id)';
      const cascadeClause = refMatch[3] || '';
      const constraintName = `fk_${fk.table}_${fk.column}`;

      statements.push(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${fk.column}) REFERENCES ${targetTable}${targetCol}${cascadeClause};`);
    }
  }

  return statements.join('\n');
}

/**
 * Remove REFERENCES clause from a column type for deferred FK creation.
 * Preserves NOT NULL and other modifiers.
 */
function stripReferences(columnType: string): string {
  // Remove REFERENCES clause and any ON DELETE/UPDATE clauses
  return columnType
    .replace(/\s*REFERENCES\s+\w+(\([^)]+\))?(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))*\s*/gi, ' ')
    .trim();
}
