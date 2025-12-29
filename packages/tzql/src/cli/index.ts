#!/usr/bin/env bun
import { loadDomain } from "./compiler/loader.js";
import { analyzeDomain } from "./compiler/analyzer.js";
import { generateIR } from "./compiler/ir.js";
import { generateCoreSQL, generateEntitySQL, generateSchemaSQL } from "./codegen/sql.js";
import { generateSubscribableSQL } from "./codegen/subscribable_sql.js";
import { generateManifest } from "./codegen/manifest.js";
import { generateSubscribableStore } from "./codegen/subscribable_store.js";
import { generateClientSDK } from "./codegen/client.js";
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";

const args = process.argv.slice(2);
const command = args[0];
const input = args[1];
let outputDir = "dist"; // Default output directory

// Parse optional output directory flag
const outputFlagIndex = args.indexOf('-o');
const longOutputFlagIndex = args.indexOf('--output');

if (outputFlagIndex > -1 && args[outputFlagIndex + 1]) {
  outputDir = args[outputFlagIndex + 1];
} else if (longOutputFlagIndex > -1 && args[longOutputFlagIndex + 1]) {
  outputDir = args[longOutputFlagIndex + 1];
}

async function main() {
  console.log("TZQL Compiler v0.0.1");

  if (command === "compile") {
    if (!input) {
      console.error("Usage: tzql compile <file>");
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
      const entitySQL: string[] = [];
      for (const [name, entityIR] of Object.entries(ir.entities)) {
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
      for (const [name, subIR] of Object.entries(ir.subscribables)) {
        console.log(`[Compiler] Generating SQL for subscribable: ${name}`);
        subscribableSQL.push(generateSubscribableSQL(name, subIR as any, ir.entities));
      }

      // Collect custom functions SQL
      const customFunctionSQL: string[] = [];
      for (const fn of ir.customFunctions) {
        console.log(`[Compiler] Adding custom function: ${fn.name}`);
        customFunctionSQL.push(fn.sql);
      }

      // Phase 4: Generate Manifest
      const manifest = generateManifest(ir);
      console.log(`[Compiler] Manifest functions: ${Object.keys(manifest.functions).length}`);
      if (!manifest.functions['subscribe_venue_detail']) {
          console.error("[Compiler] ERROR: subscribe_venue_detail missing from manifest functions!");
      }

      // --- OUTPUT GENERATION ---

      // 1. Database
      const dbDir = resolve(outputDir, "db/migrations");
      mkdirSync(dbDir, { recursive: true });

      writeFileSync(resolve(dbDir, `000_core.sql`), coreSQL);
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '');

      // Combine entity SQL with custom functions
      const schemaContent = customFunctionSQL.length > 0
        ? entitySQL.join('\n') + '\n\n-- Custom Functions\n' + customFunctionSQL.join('\n\n')
        : entitySQL.join('\n');
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

      // Generate Core SDK
      const clientCode = generateClientSDK(manifest, false); // JS implementation
      const clientTypes = generateClientSDK(manifest, true); // D.TS interface

      writeFileSync(resolve(clientDir, `ws.js`), clientCode);
      writeFileSync(resolve(clientDir, `ws.d.ts`), clientTypes);

      // Generate Index
      writeFileSync(resolve(clientDir, `index.js`), `export * from './ws.js';`);
      writeFileSync(resolve(clientDir, `index.d.ts`), `export * from './ws.js';`);

      console.log(`[Generated] Client SDK in ${clientDir}`);

      // 4. Stores (TypeScript)
      const storeDir = resolve(clientDir, "stores");
      mkdirSync(storeDir, { recursive: true });

      for (const subName of Object.keys(ir.subscribables)) {
          const storeCode = generateSubscribableStore(manifest, subName);
          const fileName = `use${subName.replace(/(^|_)([a-z])/g, (g) => g.at(-1).toUpperCase())}Store.js`;
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
