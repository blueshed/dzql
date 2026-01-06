#!/usr/bin/env bun
import { loadDomain } from "./compiler/loader.js";
import { analyzeDomain } from "./compiler/analyzer.js";
import { generateIR } from "./compiler/ir.js";
import { generateCoreSQL, generateAuthSQL, generateEntitySQL, generateSchemaSQL } from "./codegen/sql.js";
import { generateSubscribableSQL, generateComputeAffectedKeysFunction } from "./codegen/subscribable_sql.js";
import { generateManifest } from "./codegen/manifest.js";
import { generateSubscribableStore } from "./codegen/subscribable_store.js";
import { generateClientSDK } from "./codegen/client.js";
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";

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
  console.log("DZQL Compiler v0.6.0");

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
      const sortedEntityNames = topologicalSortEntities(ir.entities);

      const entitySQL: string[] = [];
      for (const name of sortedEntityNames) {
        const entityIR = ir.entities[name];
        entitySQL.push(generateSchemaSQL(name, entityIR));
        // Skip CRUD generation for unmanaged entities (e.g., junction tables)
        if (entityIR.managed !== false) {
          entitySQL.push(generateEntitySQL(name, entityIR));
        } else {
          console.log(`[Compiler] Skipping CRUD for unmanaged entity: ${name}`);
        }
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
  } else {
    console.log("Unknown command. Try 'compile'.");
  }
}

main();

/**
 * Topologically sort entities based on FK dependencies.
 * Entities that are referenced by others come first.
 * Uses Kahn's algorithm for topological sorting.
 */
function topologicalSortEntities(entities: Record<string, any>): string[] {
  const entityNames = Object.keys(entities);

  // Build dependency graph: entity -> entities it depends on (references)
  const dependencies: Record<string, Set<string>> = {};
  const dependents: Record<string, Set<string>> = {};

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
        }
      }
    }
  }

  // Kahn's algorithm
  const result: string[] = [];
  const noIncoming: string[] = [];

  // Find entities with no dependencies (no incoming edges)
  for (const name of entityNames) {
    if (dependencies[name].size === 0) {
      noIncoming.push(name);
    }
  }

  while (noIncoming.length > 0) {
    const node = noIncoming.shift()!;
    result.push(node);

    // Remove this node from the graph
    for (const dependent of dependents[node]) {
      dependencies[dependent].delete(node);
      if (dependencies[dependent].size === 0) {
        noIncoming.push(dependent);
      }
    }
  }

  // Check for cycles
  if (result.length !== entityNames.length) {
    const remaining = entityNames.filter(n => !result.includes(n));
    console.warn(`[Compiler] Warning: Circular FK dependencies detected among: ${remaining.join(', ')}`);
    // Add remaining entities anyway (they may have circular refs)
    result.push(...remaining);
  }

  return result;
}
