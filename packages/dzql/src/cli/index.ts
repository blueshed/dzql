#!/usr/bin/env bun
import { loadDomain } from "./compiler/loader.js";
import { compileDomain, DomainValidationError } from "./compile.js";
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

// delta's Postgres commands (dzql is delta's Postgres step): sql, init, migrate, link
if (["sql", "init", "migrate", "link"].includes(args[0] ?? "")) {
  const { main } = await import("../postgres/cli.ts");
  await main(args);
  process.exit(0);
}
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

      let compiled;
      try {
        compiled = compileDomain(domain);
      } catch (e) {
        if (e instanceof DomainValidationError) {
          console.error("[Compiler] Validation Failed:");
          e.errors.forEach(err => console.error(`  - ${err}`));
          process.exit(1);
        }
        throw e;
      }
      const { ir, coreSQL, schemaSQL } = compiled;
      console.log(`[Compiler] IR Generated. Subscribables: ${Object.keys(ir.subscribables).join(', ')}`);

      // Phase 4: Generate Manifest
      const manifest = generateManifest(ir);

      // --- OUTPUT GENERATION ---

      // 1. Database
      const dbDir = resolve(outputDir, "db/migrations");
      mkdirSync(dbDir, { recursive: true });

      writeFileSync(resolve(dbDir, `000_core.sql`), coreSQL);
      const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
      writeFileSync(resolve(dbDir, `${timestamp}_schema.sql`), schemaSQL);

      if (compiled.customFunctionCount > 0) {
        console.log(`[Generated] ${compiled.customFunctionCount} Custom Functions`);
      }

      // Write subscribable SQL
      writeFileSync(resolve(dbDir, `${timestamp}_subscribables.sql`), compiled.subscribableSQL);
      console.log(`[Generated] Subscribable SQL for ${Object.keys(ir.subscribables).length} subscribables`);

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
