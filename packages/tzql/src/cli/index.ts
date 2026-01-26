#!/usr/bin/env bun
import { loadDomain } from "./compiler/loader.js";
import { analyzeDomain } from "./compiler/analyzer.js";
import { generateIR } from "./compiler/ir.js";
import { generateCoreSQL, generateAuthSQL, generateEntitySQL, generateSchemaSQL } from "./codegen/sql.js";
import { generateSubscribableSQL, generateComputeAffectedKeysFunction } from "./codegen/subscribable_sql.js";
import { generateManifest } from "./codegen/manifest.js";
import { generateSubscribableStore } from "./codegen/subscribable_store.js";
import { generateClientSDK } from "./codegen/client.js";
import { validatePaths } from "./compiler/path-validator.js";
import { writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from "fs";
import { resolve, dirname } from "path";

// Read version from package.json
const packageJsonPath = resolve(dirname(import.meta.url.replace('file://', '')), '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

const args = process.argv.slice(2);
let command = args[0];
let input = args[1];
let outputDir = "dist"; // Default output directory

// If first arg looks like a file (ends with .ts or .js), treat it as compile target
if (command && (command.endsWith('.ts') || command.endsWith('.js'))) {
  input = command;
  command = 'compile';
}

// Parse optional output directory flag
const outputFlagIndex = args.indexOf('-o');
const longOutputFlagIndex = args.indexOf('--output');

if (outputFlagIndex > -1 && args[outputFlagIndex + 1]) {
  outputDir = args[outputFlagIndex + 1];
} else if (longOutputFlagIndex > -1 && args[longOutputFlagIndex + 1]) {
  outputDir = args[longOutputFlagIndex + 1];
}

async function main() {
  console.log(`DZQL Compiler v${VERSION}`);

  if (command === "compile") {
    if (!input) {
      console.error("Usage: dzql <file> or dzql compile <file>");
      process.exit(1);
    }

    try {
      // Phase 1: Load & Analyze
      const fullInputPath = resolve(process.cwd(), input);

      // Clean Output Directory
      const absOutputDir = resolve(process.cwd(), outputDir);
      console.log(`[Compiler] Cleaning ${absOutputDir}...`);
      try {
        rmSync(absOutputDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }

      const domain = await loadDomain(fullInputPath);
      console.log("[Compiler] Domain loaded.");

      const errors = analyzeDomain(domain);
      if (errors.length > 0) {
        console.error("[Compiler] Validation Failed:");
        errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
      }

      // Phase 2: Generate IR
      const ir = generateIR(domain);
      console.log(`[Compiler] IR Generated. Subscribables: ${Object.keys(ir.subscribables).join(', ')}`);

      // Phase 3: Generate SQL
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
          entitySQL.push(generateEntitySQL(name, entityIR));
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

      // Phase 4: Generate Manifest
      const manifest = generateManifest(ir);

      // --- OUTPUT GENERATION ---

      // 1. Database
      const dbDir = resolve(outputDir, "db/migrations");
      mkdirSync(dbDir, { recursive: true });

      writeFileSync(resolve(dbDir, `000_core.sql`), coreSQL);
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '');

      // Combine entity SQL with auth functions and custom functions
      // Auth functions must come after schema (they depend on users table)
      const authSQL = generateAuthSQL();
      let schemaContent = entitySQL.join('\n');
      schemaContent += '\n\n-- Auth Functions\n' + authSQL;
      if (customFunctionSQL.length > 0) {
        schemaContent += '\n\n-- Custom Functions\n' + customFunctionSQL.join('\n\n');
      }
      writeFileSync(resolve(dbDir, `${timestamp}_schema.sql`), schemaContent);

      if (customFunctionSQL.length > 0) {
        console.log(`[Generated] ${customFunctionSQL.length} Custom Functions`);
      }

      // Write subscribable SQL
      if (subscribableSQL.length > 0) {
        writeFileSync(resolve(dbDir, `${timestamp}_subscribables.sql`), subscribableSQL.join('\n\n'));
        console.log(`[Generated] ${subscribableSQL.length} Subscribable SQL functions`);
      }

      console.log(`[Generated] DB Migrations in ${dbDir}`);

      // 2. Runtime
      const runtimeDir = resolve(outputDir, "runtime");
      mkdirSync(runtimeDir, { recursive: true });
      writeFileSync(resolve(runtimeDir, `manifest.json`), JSON.stringify(manifest, null, 2));
      console.log(`[Generated] Runtime Manifest in ${runtimeDir}`);

      // 3. Client SDK (TypeScript)
      const clientDir = resolve(outputDir, "client");
      mkdirSync(clientDir, { recursive: true });

      // Generate Core SDK as TypeScript
      const clientCode = generateClientSDK(manifest);
      writeFileSync(resolve(clientDir, `ws.ts`), clientCode);

      // Generate Index
      writeFileSync(resolve(clientDir, `index.ts`), `export * from './ws.js';`);

      console.log(`[Generated] Client SDK in ${clientDir}`);

      // 4. Stores (TypeScript)
      const storeDir = resolve(clientDir, "stores");
      mkdirSync(storeDir, { recursive: true });

      for (const subName of Object.keys(ir.subscribables)) {
          const storeCode = generateSubscribableStore(manifest, subName);
          const fileName = `use${subName.replace(/(^|_)([a-z])/g, (g) => g.at(-1)!.toUpperCase())}Store.ts`;
          writeFileSync(resolve(storeDir, fileName), storeCode);
      }
      console.log(`[Generated] ${Object.keys(ir.subscribables).length} Pinia Stores in ${storeDir}`);

      console.log("[Compiler] Build Complete.");

    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  } else if (command === "validate-paths") {
    if (!input) {
      console.error("Usage: dzql validate-paths <file>");
      process.exit(1);
    }

    try {
      const fullInputPath = resolve(process.cwd(), input);
      const domain = await loadDomain(fullInputPath);

      const results = validatePaths(domain);

      let hasErrors = false;
      for (const result of results) {
        const status = result.valid ? '✓' : '✗';
        const location = `${result.entity}.${result.pathType}[${result.pathIndex}]`;

        if (result.valid) {
          console.log(`${status} ${location}: valid`);
        } else {
          console.log(`${status} ${location}: ${result.error}`);
          hasErrors = true;
        }
      }

      console.log(`\n${results.length} paths validated, ${results.filter(r => !r.valid).length} errors`);

      if (hasErrors) {
        process.exit(1);
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  } else {
    console.log("Unknown command. Try 'compile' or 'validate-paths'.");
  }
}

main();

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
