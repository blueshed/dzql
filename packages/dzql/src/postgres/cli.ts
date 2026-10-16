#!/usr/bin/env bun
/**
 * dzql's Postgres commands, as delta's CLI had them: `dzql sql`, `dzql init`,
 * `dzql migrate` (a postgres:// URL or a PGlite directory), and `dzql link`. Run through
 * `dzql <command>` (src/cli/index.ts hands these four here).
 */
import { parseArgs } from "node:util";
import { resolve, basename, join, dirname } from "node:path";
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { generateSql } from "./codegen";
import { frameworkSqlFiles } from "./bootstrap";
import { authJwtSqlFile } from "./auth-jwt-sql";
import type { Schema, DocDef } from "./index";

const PKG_VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

const USAGE =
    `Usage:\n` +
    `  dzql sql <module> [--out <file>] [--force] [--schema-export <name>] [--docs-export <name>]\n` +
    `  dzql init <dir> [--with-auth] [--upgrade]\n` +
    `  dzql migrate <database> [--app <name>] [--dir <migrations>] [--status] [--json]\n` +
    `        <database>: a PGlite directory or a postgres:// URL; --dir defaults to ./migrations\n` +
    `  dzql link <database> <person> [--origin <url>] [--opens <path>] [--json]\n` +
    `        a link to sign in as someone (link sign-in): the first person's, on the server\n` +
    `\n` +
    `Exit codes: 0 done, 1 an error, 2 a bad argument.\n`;

let json = process.argv.includes("--json");

const print = (result: unknown) => process.stdout.write(JSON.stringify(result ?? null, null, json ? undefined : 2) + "\n");

function fail(err: unknown, exit = 1): never {
  const error = { code: 0, message: err instanceof Error ? err.message : String(err) };
  process.stderr.write((json ? JSON.stringify({ error }) : `dzql: ${error.message}`) + "\n");
  process.exit(exit);
}

function usageError(why: string, show = false): never {
  if (show && !json) process.stderr.write(USAGE + "\n");
  fail(why, 2);
}

// ---------------------------------------------------------------------------
// Header handling — identifies files written by dzql init (stamped with this
// package's version) so upgrades can read them back and avoid clobbering
// user-owned SQL, and a `diff -u` against a later `init --upgrade` shows what changed.
// ---------------------------------------------------------------------------

// a file `delta init` vendored (stamped @blueshed/delta) is older than any of dzql's: always upgraded
const HEADER_RE = /^-- @blueshed\/(delta|dzql) ([a-z0-9-]+) v(\d+\.\d+\.\d+)/;

function readHeader(path: string): { pkg: string; kind: string; version: string } | null {
  if (!existsSync(path)) return null;
  const first = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
  const m = first.match(HEADER_RE);
  return m ? { pkg: m[1]!, kind: m[2]!, version: m[3]! } : null;
}

function writeWithHeader(src: string, dest: string, kind: "framework" | "auth-jwt"): void {
  const header =
    `-- @blueshed/dzql ${kind} v${PKG_VERSION}\n` +
    `-- Vendored by 'dzql init'. Safe to read; prefer 'dzql init --upgrade' over hand edits.\n\n`;
  writeFileSync(dest, header + readFileSync(src, "utf8"));
}

/**
 * Back up `dest` to `dest + ".bak"` without destroying a pre-existing backup.
 * If `dest.bak` already exists, fall back to `.bak.1`, `.bak.2`, … so an
 * earlier backup the user may still need is preserved. Returns the path the
 * backup was written to.
 */
function backupFile(dest: string): string {
  let bak = dest + ".bak";
  if (existsSync(bak)) {
    let n = 1;
    while (existsSync(`${dest}.bak.${n}`)) n++;
    bak = `${dest}.bak.${n}`;
    process.stderr.write(
      `Note: ${basename(dest)}.bak already exists; backing up to ${basename(bak)} instead.\n`,
    );
  }
  copyFileSync(dest, bak);
  return bak;
}

// ---------------------------------------------------------------------------
// dzql sql
// ---------------------------------------------------------------------------

// Stable substring of the codegen header (see codegen.ts:
// "GENERATED FROM types.ts — DO NOT EDIT"). Matching on the leading words
// avoids depending on the em-dash byte sequence.
const GENERATED_MARKER = "GENERATED FROM";

async function cmdSql(modulePath: string | undefined, values: Record<string, unknown>) {
  if (!modulePath) usageError("sql takes a <module>", true);

  const abs = resolve(process.cwd(), modulePath);
  let mod: Record<string, unknown>;
  try {
    mod = await import(abs);
  } catch (err) {
    // Bun surfaces a `ResolveMessage` whose `.message` is a single useful line
    // (e.g. "Cannot find module '…'") but is fronted by the class-name prefix;
    // strip it to a clean one-liner instead of dumping the raw object/stack.
    const raw =
      err instanceof Error ? err.message.split("\n", 1)[0] : String(err);
    const reason = raw.replace(/^(ResolveMessage|BuildMessage|Error):\s*/, "");
    process.stderr.write(`Cannot load module "${modulePath}": ${reason}\n`);
    process.exit(2);
  }

  const schemaExport = values["schema-export"] as string;
  const docsExport = values["docs-export"] as string;
  const schema = mod[schemaExport] as Schema | undefined;
  const docs = mod[docsExport] as DocDef[] | undefined;

  if (!schema || typeof schema !== "object" || !("tables" in schema)) {
    process.stderr.write(
      `Module at ${modulePath} does not export a Schema as \`${schemaExport}\`.\n` +
      `Export one with: export const ${schemaExport} = defineSchema({ ... });\n`,
    );
    process.exit(2);
  }
  if (!Array.isArray(docs)) {
    process.stderr.write(
      `Module at ${modulePath} does not export a DocDef[] as \`${docsExport}\`.\n` +
      `Export one with: export const ${docsExport} = [defineDoc(...), ...];\n`,
    );
    process.exit(2);
  }

  const sql = generateSql(schema, docs);
  const out = values.out as string | undefined;
  const force = !!values.force;

  if (out) {
    const absOut = resolve(out);
    // Guard: never silently clobber a file we didn't generate. A previously
    // generated file carries the codegen header marker and is safe to replace;
    // anything else needs --force.
    if (existsSync(absOut) && !force) {
      const existing = readFileSync(absOut, "utf8");
      if (!existing.includes(GENERATED_MARKER)) {
        process.stderr.write(
          `Refusing to overwrite ${out}: it has no generated-file header ` +
          `(not produced by 'dzql sql').\n` +
          `Pass --force to overwrite it anyway.\n`,
        );
        process.exit(3);
      }
      // It's a previously generated file — back it up before replacing.
      backupFile(absOut);
    }
    mkdirSync(dirname(absOut), { recursive: true });
    await Bun.write(out, sql);
    process.stderr.write(`Wrote ${out} (${sql.length} bytes)\n`);
  } else {
    process.stdout.write(sql);
  }
}

// ---------------------------------------------------------------------------
// dzql init
// ---------------------------------------------------------------------------

function cmdInit(dir: string | undefined, values: Record<string, unknown>) {
  if (!dir) usageError("init takes a <dir>", true);

  const absDir = resolve(process.cwd(), dir);
  mkdirSync(absDir, { recursive: true });

  const upgrade = !!values.upgrade;
  const plan: { src: string; dest: string; kind: "framework" | "auth-jwt" }[] =
    frameworkSqlFiles().map((src) => ({ src, dest: join(absDir, basename(src)), kind: "framework" }));
  if (values["with-auth"]) plan.push({ src: authJwtSqlFile(), dest: join(absDir, "002-users.sql"), kind: "auth-jwt" });

  // On upgrade we refuse to clobber files that don't have our header or that
  // point to a newer version than we ship. The user either wrote that file
  // themselves or has downgraded the package.
  if (upgrade) {
    const conflicts: string[] = [];
    for (const { dest } of plan) {
      if (!existsSync(dest)) continue;
      const hdr = readHeader(dest);
      if (!hdr) conflicts.push(`${basename(dest)}: not stamped by dzql init (or delta init)`);
      else if (hdr.pkg === "dzql" && compareVersion(hdr.version, PKG_VERSION) > 0) {
        conflicts.push(`${basename(dest)}: has v${hdr.version}, package is v${PKG_VERSION}`);
      }
    }
    if (conflicts.length) {
      process.stderr.write(
        `Refusing to upgrade:\n  ${conflicts.join("\n  ")}\n\n` +
        `Resolve these manually (move or rename the offending files) and rerun.\n`,
      );
      process.exit(3);
    }
  }

  const created: string[] = [];
  const upgraded: string[] = [];
  const unchanged: string[] = [];

  for (const { src, dest, kind } of plan) {
    if (existsSync(dest)) {
      const hdr = readHeader(dest);
      if (!upgrade || (hdr?.pkg === "dzql" && hdr.version === PKG_VERSION)) {
        unchanged.push(basename(dest));
        continue;
      }
      const bak = backupFile(dest);
      writeWithHeader(src, dest, kind);
      upgraded.push(`${basename(dest)} (backup at ${basename(bak)})`);
    } else {
      writeWithHeader(src, dest, kind);
      created.push(basename(dest));
    }
  }

  const lines: string[] = [];
  if (created.length) lines.push("Created:\n  " + created.join("\n  "));
  if (upgraded.length) lines.push("Upgraded:\n  " + upgraded.join("\n  "));
  if (unchanged.length) lines.push("Unchanged:\n  " + unchanged.join("\n  "));
  process.stderr.write((lines.join("\n\n") || "Nothing to do.") + "\n");

  if (created.length || upgraded.length) {
    process.stderr.write(
      `\nNext: regenerate your table SQL from types.ts:\n` +
      `  bunx dzql sql ./types.ts --out ${dir}/003-tables.sql\n`,
    );
  }
}

function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// dzql migrate
// ---------------------------------------------------------------------------

/**
 * Run an app's migrations (`--dir`, default ./migrations, each `NNN-name.ts`
 * exporting `up`; `--app` names the app when apps share the database) against
 * its database, or with --status say which ran and which are pending. With no
 * schema to ask, an app with nothing recorded is new only to a database with
 * no table but delta's: the app's own start-up, given its schema, knows better.
 * The database: a postgres:// URL or a PGlite directory that is there (a name
 * mistyped makes no new database). A SQLite file is delta's own command.
 */
async function cmdMigrate(target: string | undefined, values: Record<string, unknown>) {
  if (!target) usageError("migrate takes a <database>: a PGlite directory or a postgres:// URL", true);
  const { setLogLevel } = await import("@blueshed/delta/logger");
  setLogLevel(json ? "silent" : "warn");
  const dir = resolve(process.cwd(), (values.dir as string | undefined) ?? "migrations");
  const status = !!values.status;
  const options = { app: (values.app as string | undefined) ?? "" };
  const isUrl = /^postgres(ql)?:\/\//.test(target);
  const path = resolve(process.cwd(), target);
  if (!isUrl && (!existsSync(path) || !statSync(path).isDirectory())) usageError(`no PGlite database at ${target} (a SQLite file is delta's: bunx @blueshed/delta migrate)`);
  if (!existsSync(dir)) usageError(`no migrations folder at ${dir} (--dir)`);

  let answer: unknown;
  const pg = await import("./migrate");
  let pool: any;
  if (isUrl) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: target });
  } else {
    const { openPglite } = await import("./pglite");
    pool = await openPglite(path);
  }
  try {
    const list = await pg.fromFolder(dir);
    answer = status ? await pg.migrationStatus(pool, list, options) : await pg.migrate(pool, list, options);
  } finally { await pool.end(); }
  if (json) return print(answer);
  if (status) {
    const s = answer as import("@blueshed/delta/backend").MigrationStatus;
    if (s.fresh) process.stdout.write("new database: migrate records every migration as run, and runs none\n");
    for (const r of s.ran) process.stdout.write(`ran      ${r.id}  ${r.ran_at}\n`);
    for (const id of s.pending) process.stdout.write(`pending  ${id}\n`);
    for (const id of s.unknown) process.stdout.write(`unknown  ${id}  (ran here, not in ${dir})\n`);
    return;
  }
  const r = answer as import("@blueshed/delta/backend").MigrateResult;
  if (r.fresh) process.stdout.write("new database: every migration recorded as run, none run\n");
  for (const id of r.ran) process.stdout.write(`ran      ${id}\n`);
  if (!r.fresh && r.ran.length === 0) process.stdout.write("nothing to run\n");
}

// ---------------------------------------------------------------------------
// dzql link
// ---------------------------------------------------------------------------

/**
 * A link to sign in as `person` (link sign-in, `dzql/auth-link`), made in the app's Postgres: how
 * the first person signs in, before anyone can send them one. The site is --origin, else ORIGIN,
 * else Railway's domain. The database as `migrate` takes it. A SQLite file is delta's (`delta link`).
 */
async function cmdLink(target: string | undefined, person: string | undefined, values: Record<string, unknown>) {
  if (!target || !person) usageError("link takes a <database> and a <person>: dzql link postgres://… 1", true);
  if (!/^\d+$/.test(person)) usageError(`<person> is a person's id, a number: ${person}`);
  const isUrl = /^postgres(ql)?:\/\//.test(target);
  const path = resolve(process.cwd(), target);
  if (!isUrl && (!existsSync(path) || !statSync(path).isDirectory())) usageError(`no PGlite database at ${target} (a SQLite file is delta's: bunx @blueshed/delta link)`);
  const { makeLink, siteOrigin } = await import("@blueshed/delta/auth-link");
  let origin: string;
  try { origin = (values.origin as string | undefined) ?? siteOrigin(); }
  catch (err) { usageError(`${(err as Error).message}, or pass --origin`); }
  const { postgresLinkStore } = await import("./auth-link");
  let pool: any;
  if (isUrl) {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: target });
  } else {
    const { openPglite } = await import("./pglite");
    pool = await openPglite(path);
  }
  try {
    const made = await makeLink(await postgresLinkStore(pool), Number(person), { origin, opens: values.opens as string | undefined });
    if (json) return print(made);
    process.stdout.write(`${made.url}\n(used once, until ${made.expires})\n`);
  } finally { await pool.end(); }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv: string[]) {
  let parsed;
  try { parsed = parseArgs({
    args: argv,
    options: {
      out: { type: "string", short: "o" },
      force: { type: "boolean", default: false },
      "schema-export": { type: "string", default: "schema" },
      "docs-export": { type: "string", default: "docs" },
      "with-auth": { type: "boolean", default: false },
      upgrade: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      dir: { type: "string" },
      app: { type: "string" },
      status: { type: "boolean", default: false },
      origin: { type: "string" },
      opens: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  }); }
  catch (err) { usageError((err as Error).message, true); }
  const { values, positionals } = parsed;
  json = !!values.json;
  if (values.help) { process.stdout.write(USAGE); return; }
  const [cmd, arg, arg2] = positionals;
  switch (cmd) {
    case "sql":     return cmdSql(arg, values);
    case "init":    return cmdInit(arg, values);
    case "migrate": return cmdMigrate(arg, values);
    case "link":    return cmdLink(arg, arg2, values);
    default:        usageError(cmd ? `no command ${cmd}` : "a command, please", true);
  }
}

if (import.meta.main) main(process.argv.slice(2)).catch((err) => fail(err));
