#!/usr/bin/env bun
/**
 * Post-install setup script for bun create
 * Updates configuration files with the project name
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, basename } from "path";

const projectDir = process.cwd();
const projectName = basename(projectDir);

console.log(`Setting up ${projectName}...`);

// Update compose.yml with project name as database name
const composePath = resolve(projectDir, "compose.yml");
let compose = readFileSync(composePath, "utf-8");
compose = compose.replace(/POSTGRES_DB: .+/, `POSTGRES_DB: ${projectName}`);
writeFileSync(composePath, compose);

// Update .env.example with project name in DATABASE_URL
const envExamplePath = resolve(projectDir, ".env.example");
let envExample = readFileSync(envExamplePath, "utf-8");
envExample = envExample.replace(
  /DATABASE_URL=postgres:\/\/postgres:postgres@localhost:5432\/.+/,
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/${projectName}`
);
writeFileSync(envExamplePath, envExample);

// Create .env from .env.example if it doesn't exist
const envPath = resolve(projectDir, ".env");
try {
  readFileSync(envPath);
} catch {
  writeFileSync(envPath, envExample);
  console.log("Created .env from .env.example");
}

// Update server.ts default DATABASE_URL
const serverPath = resolve(projectDir, "server.ts");
let server = readFileSync(serverPath, "utf-8");
server = server.replace(
  /postgres:\/\/postgres:postgres@localhost:5432\/[^"]+/,
  `postgres://postgres:postgres@localhost:5432/${projectName}`
);
writeFileSync(serverPath, server);

console.log(`\nProject "${projectName}" is ready!`);
console.log(`\nNext steps:`);
console.log(`  cd ${projectName}`);
console.log(`  bun install`);
console.log(`  bun run setup`);
console.log(`  bun run dev`);
