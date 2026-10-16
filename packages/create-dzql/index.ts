#!/usr/bin/env bun
/**
 * `bun create dzql my-app`: a paintbrush app on dzql. People register and sign in, and share posts,
 * kept in Postgres: everyone's live, each person's own to change. Copies `template/`, puts the app's
 * name in it, and says what to run.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2] || "my-dzql-app";
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`"${name}" is not a name for an app: lower case letters, digits and dashes`);
  process.exit(1);
}
const dest = join(process.cwd(), name);
if (existsSync(dest)) {
  console.error(`Error: "${name}" already exists`);
  process.exit(1);
}

console.log(`Creating ${name}...`);
cpSync(join(import.meta.dir, "template"), dest, { recursive: true });

// npm leaves dotfiles of a package behind: they travel without their dot
renameSync(join(dest, "gitignore"), join(dest, ".gitignore"));
renameSync(join(dest, "env.example"), join(dest, ".env.example"));

// The app's name in place of {{name}}, in every file
const named = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) named(path);
    else {
      const text = readFileSync(path, "utf8");
      if (text.includes("{{name}}")) writeFileSync(path, text.replaceAll("{{name}}", name));
    }
  }
};
named(dest);
cpSync(join(dest, ".env.example"), join(dest, ".env"));

console.log(`
Done. To start:

  cd ${name}
  bun install
  bun run db:up      # a Postgres server in Docker (compose.yml)
  bun dev            # http://localhost:3000

  bun test           # the app's tests: Postgres in memory, two browsers
`);
