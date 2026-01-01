#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";

const destName = process.argv[2] || "my-dzql-app";
const dest = join(process.cwd(), destName);

if (existsSync(dest)) {
  console.error(`Error: Directory "${destName}" already exists`);
  process.exit(1);
}

// Get the directory where this script is located (the package root)
const templateDir = dirname(new URL(import.meta.url).pathname);

// Files/dirs to copy (excluding node_modules, package-lock, and this script)
const exclude = ["node_modules", "package-lock.json", "bun.lockb", "index.ts", ".git", destName];

// Copy template files
console.log(`Creating ${destName}...`);
mkdirSync(dest, { recursive: true });

for (const entry of readdirSync(templateDir)) {
  if (exclude.includes(entry)) continue;

  const src = join(templateDir, entry);
  const target = join(dest, entry);

  cpSync(src, target, { recursive: true });
}

// Replace {{name}} placeholders
const filesToProcess = [
  "package.json",
  "compose.yml",
  ".env.example",
  "README.md",
  "server/package.json",
  "client/package.json",
  "client/index.html"
];

for (const file of filesToProcess) {
  const filePath = join(dest, file);
  if (existsSync(filePath)) {
    let content = readFileSync(filePath, "utf-8");
    content = content.replace(/\{\{name\}\}/g, destName);
    writeFileSync(filePath, content);
  }
}

// Copy .env.example to .env
const envExample = join(dest, ".env.example");
const envFile = join(dest, ".env");
if (existsSync(envExample)) {
  cpSync(envExample, envFile);
}

// Remove setup.sh and bun-create field (not needed when using this script)
const setupSh = join(dest, "setup.sh");
if (existsSync(setupSh)) {
  unlinkSync(setupSh);
}

// Clean up the destination package.json - remove template-only fields
const destPkgPath = join(dest, "package.json");
if (existsSync(destPkgPath)) {
  const pkg = JSON.parse(readFileSync(destPkgPath, "utf-8"));
  delete pkg["bun-create"];
  delete pkg.bin;
  delete pkg.files;
  pkg.name = destName;
  pkg.private = true;
  writeFileSync(destPkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

console.log(`
Done! To get started:

  cd ${destName}
  bun install
  bun run db:rebuild
  bun run dev
`);
