/**
 * Codegen — turn a TypeScript schema (`defineSchema`) and a set of doc
 * definitions (`defineDoc`) into the app's SQL: its tables, and each document
 * compiled.
 *
 * Output includes:
 *   - CREATE SEQUENCE / CREATE TABLE (+ current_* view for temporal tables)
 *   - Helper indexes
 *   - INSERT INTO _delta_collections (columns_def, parent, temporal, cascade_on), which a listener
 *     given no schema shows by
 *   - each document and collection compiled (src/compile/), and each table's row-level security
 *
 * Everything is idempotent (CREATE … IF NOT EXISTS, ON CONFLICT DO UPDATE),
 * so the same file can be re-applied to a live database after a schema change.
 *
 * Drive it from your project's `types.ts`:
 *
 *   import { generateSql } from "dzql/postgres";
 *   import { schema, docs } from "./types";
 *   await Bun.write("init_db/003-tables.sql", generateSql(schema, docs));
 *
 * Or from the bundled CLI:
 *
 *   bunx dzql sql ./types.ts --out init_db/003-tables.sql
 */
import type { Schema, DocDef } from "./schema";
import { lit, columnSqlType, currentViewSql, seqOf, sqlDefault, findCascadeOn } from "./sql";
import { defaultForType, isServerTime, q, uniqueIndexSql, type ColumnDef } from "@blueshed/delta/backend";
import { assertScopeKeys } from "@blueshed/delta/backend";
import { compileOpens } from "../compile/opens";
import { compileHolds } from "../compile/holds";
import { compileInScope } from "../compile/scope";
import { compileHolders, compileRescopes } from "../compile/holders";
import { compileResolve } from "../compile/resolve";
import { compileRootThere } from "../compile/root";
import { compileColumns } from "../compile/columns";
import { compileRows } from "../compile/rows";
import { compileCascades } from "../compile/cascades";
import { compileRefs } from "../compile/refs";
import { compileLedger } from "../compile/ledger";
import { compileLookups } from "../compile/lookups";
import { compileTold } from "../compile/told";
import { compileOwns } from "../compile/owns";
import { compilePolicies } from "../compile/policies";

export interface GenerateSqlOptions {
  /** The module the definitions came from (`dzql sql` names it): the header says it, and how to make the file again. */
  from?: string;
}

export function generateSql(
  schema: Schema,
  docs: DocDef[],
  opts: GenerateSqlOptions = {},
): string {
  // no date: the same definitions make the same file, so a committed one changes only with them
  const lines: string[] = [
    "-- =========================================================================",
    `-- GENERATED FROM ${opts.from ?? "the app's definitions"} by dzql — DO NOT EDIT`,
    ...(opts.from ? [`-- Regenerate: bunx dzql sql ${opts.from}`] : []),
    "-- =========================================================================",
    "",
  ];

  for (const [key, table] of Object.entries(schema.tables)) lines.push(...tableSql(key, table));

  // Collection metadata
  lines.push("-- Collection metadata");
  for (const [key, table] of Object.entries(schema.tables)) {
    const cascadeOn = lit(JSON.stringify(findCascadeOn(key, schema)));
    const colsDef = lit(JSON.stringify(table.columns));
    const parent = table.parent ? lit(table.parent.collection) : "NULL";
    const parentFk = table.parent ? lit(table.parent.fkColumn) : "NULL";
    lines.push(
      `INSERT INTO _delta_collections (collection_key, table_name, columns_def, parent_collection, parent_fk, temporal, cascade_on)`,
    );
    lines.push(
      `  VALUES (${lit(key)}, ${lit(table.name)}, ${colsDef}, ${parent}, ${parentFk}, ${table.temporal}, ${cascadeOn})`,
    );
    lines.push(
      `  ON CONFLICT (collection_key) DO UPDATE SET table_name = EXCLUDED.table_name, columns_def = EXCLUDED.columns_def,`,
    );
    lines.push(
      `    parent_collection = EXCLUDED.parent_collection, parent_fk = EXCLUDED.parent_fk, temporal = EXCLUDED.temporal, cascade_on = EXCLUDED.cascade_on;`,
    );
  }
  lines.push("");

  for (const doc of docs) assertScopeKeys(doc, schema);   // its scope's keys and the columns it names are its collections' columns

  // each document opened by SQL compiled for it (dzql), which docTypeFromDef calls
  lines.push("", compileOpens(schema, docs), "", compileHolds(schema, docs), "", compileInScope(schema, docs), "", compileTold(schema, docs), "", compileHolders(schema, docs), "", compileRescopes(schema, docs), "", compileResolve(schema, docs), "", compileRootThere(schema, docs), "", compileColumns(schema, docs), "", compileRows(schema), "", compileCascades(schema), "", compileRefs(schema), "", compileLedger(schema, docs), "", compileLookups(schema, docs), "", compileOwns(schema, docs), "", compilePolicies(schema, docs));
  return lines.join("\n");
}

/**
 * A column's default as the table keeps it. A time only the server sets (`default: "now"`) is the
 * time a row is written, to the millisecond as delta keeps a time -- never `'now'`, which Postgres
 * reads once, as the table is made. A column added with it gives each row already there the
 * migration's time, as SQLite's migrateSchema does.
 */
function columnDefault(value: unknown, def: ColumnDef): string {
  return isServerTime(def) ? "date_trunc('milliseconds', now())" : sqlDefault(value);
}

/**
 * One table's SQL, as `generateSql` writes each: its serial, the table (if it is not there), the
 * columns a later schema adds, a temporal one's view, its indexes. Every statement is idempotent: run
 * again over the table as it is, it adds what it lacks. A migration's createTable and addColumn run it.
 */
export function tableSql(key: string, table: Schema["tables"][string]): string[] {
  const lines: string[] = [];
  const seqName = seqOf(table.name);
  lines.push(`-- ${key}`);
  lines.push(`CREATE SEQUENCE IF NOT EXISTS ${q(seqName)};`);
  lines.push("");

  const cols: string[] = [
    `id BIGINT NOT NULL DEFAULT nextval(${lit(seqName)})`,
  ];
  if (table.parent) {
    cols.push(`${q(table.parent.fkColumn)} BIGINT NOT NULL`);
  }

  for (const [col, def] of Object.entries(table.columns)) {
    const sqlType = columnSqlType(def);
    const notNull = def.nullable ? "" : " NOT NULL";
    const defaultVal =
      def.default !== undefined ? ` DEFAULT ${columnDefault(def.default, def)}` : "";
    cols.push(`${q(col)} ${sqlType}${notNull}${defaultVal}`);
  }

  if (table.temporal) {
    cols.push("valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW()");
    cols.push("valid_to TIMESTAMPTZ");
    cols.push("PRIMARY KEY (id, valid_from)");
  } else {
    cols.push("PRIMARY KEY (id)");
  }

  lines.push(`CREATE TABLE IF NOT EXISTS ${q(table.name)} (`);
  lines.push(cols.map((c) => `  ${c}`).join(",\n"));
  lines.push(");");
  // A column a later schema declares, added to a table made before it (SQLite's migrateSchema): a
  // no-op on a table just made. Nullable, with its default or its type's, as migrateSchema adds it.
  if (table.parent) lines.push(`ALTER TABLE ${q(table.name)} ADD COLUMN IF NOT EXISTS ${q(table.parent.fkColumn)} BIGINT;`);
  for (const [col, def] of Object.entries(table.columns)) {
    const fill = def.default !== undefined ? def.default : def.nullable ? undefined : defaultForType(def.type);
    lines.push(`ALTER TABLE ${q(table.name)} ADD COLUMN IF NOT EXISTS ${q(col)} ${columnSqlType(def)}${fill !== undefined ? ` DEFAULT ${columnDefault(fill, def)}` : ""};`);
  }
  // Own the sequence to the table.id so `TRUNCATE RESTART IDENTITY`
  // actually resets the counter — without this, re-seeds in tests and
  // demo scripts drift by the stale sequence value.
  lines.push(`ALTER SEQUENCE ${q(seqName)} OWNED BY ${q(table.name)}.id;`);

  if (table.temporal) {
    // security_invoker (Postgres 15+): the view reads as the caller, so the table's RLS holds through it
    lines.push(
      `${currentViewSql(table.name)};`,
    );
    lines.push(
      `CREATE INDEX IF NOT EXISTS ${q("idx_" + table.name + "_id_valid")} ON ${q(table.name)} (id, valid_to);`,
    );
  }
  if (table.parent) {
    lines.push(
      `CREATE INDEX IF NOT EXISTS ${q("idx_" + table.name + "_" + table.parent.fkColumn)} ON ${q(table.name)} (${q(table.parent.fkColumn)});`,
    );
  }
  // its unique constraints, as SQLite makes them: a row that would share one's values is refused, 23505 (409)
  for (const u of table.unique ?? []) lines.push(`${uniqueIndexSql(table, u)};`);
  lines.push("");
  return lines;
}
