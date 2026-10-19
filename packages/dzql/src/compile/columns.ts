/**
 * Columns and their checks: what a write may name, and what each value must be. Asked of every op of
 * a write (`delta_apply`).
 *
 * The columns are the writing process's: `delta.declared`, set for the call by its listener, else as
 * the database last declared them (the schema is the contract: two versions on one database each
 * write by their own). So they are read at run time; what follows from the definitions is compiled:
 *
 * - `dzql_columns__<slug>(collection, columns_def)` for each document: the columns it writes, the
 *   ones it names (`columns`) where it names some. `_delta_write_columns` sends each document to its
 *   own, and refuses a name no document has.
 * - `_delta_assert_fields`: for each collection, each set of columns the definitions give it (all
 *   of them, and each document's own), checked by written statements -- the fields there are, the
 *   parent key, each column's type -- with one message each, in one order (`ORDER BY` in SQL, so the
 *   database's collation orders both alike). Another set (a walk's, another version's) is checked
 *   by the columns given (`_delta_assert_fields_declared`).
 */
import type { ColumnDef, DocDef, ResolvedTable, Schema } from "@blueshed/delta/backend";
import { lit, named, need, noDoc, prefixDispatch, caseOf } from "./opens";

/** A document's columns function: `dzql_columns__<slug>`. */
export const columnsFunction = (prefix: string): string => named("columns", prefix);

/** A set of columns as the database keeps it (`_delta_collections.columns_def`, generateSql's). */
const asStored = (columns: Record<string, ColumnDef>): string => `${lit(JSON.stringify(columns))}::jsonb`;

/** One document's columns function. */
function columnsOf(schema: Schema, doc: DocDef): string {
  const declared = "COALESCE(NULLIF(current_setting('delta.declared', true), '')::jsonb -> p_coll, p_columns_def)";
  const named = Object.entries(doc.columns ?? {});
  for (const [coll] of named) need(schema, doc, coll);
  const body = named.length === 0
    ? `  RETURN ${declared};`
    : `  v_cols := ${declared};
  CASE p_coll
${named.map(([coll, cols]) => `    WHEN ${lit(coll)} THEN RETURN ${cols.length
      ? `COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(v_cols) AS e(k, v) WHERE k IN (${cols.map(lit).join(", ")})), '{}'::jsonb)`
      : "'{}'::jsonb"};`).join("\n")}
    ELSE RETURN v_cols;
  END CASE;`;
  return `CREATE OR REPLACE FUNCTION ${columnsFunction(doc.prefix)}(p_coll TEXT, p_columns_def JSONB)
RETURNS JSONB AS $$
DECLARE
  v_cols JSONB;
BEGIN
${body}
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** What a column's value must be; none for a type it does not check. */
const MUST: Record<string, [string, (v: string) => string]> = {
  text: ["a string", (v) => `jsonb_typeof(${v}) = 'string'`],
  integer: ["an integer", (v) => `jsonb_typeof(${v}) = 'number' AND ${v}::text::numeric = trunc(${v}::text::numeric)`],
  real: ["a number", (v) => `jsonb_typeof(${v}) = 'number'`],
  boolean: ["a boolean", (v) => `jsonb_typeof(${v}) = 'boolean'`],
  timestamptz: ["an ISO-8601 time", (v) =>
    `jsonb_typeof(${v}) = 'string' AND (${v} #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}([T ]([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d{1,6})?)?(Z|[+-]([01]\\d|2[0-3])(:?[0-5]\\d)?)?)?$'`],
};

/** The checks of one set of a collection's columns, as written statements. */
function checksOf(table: ResolvedTable, columns: Record<string, ColumnDef>): string {
  const fk = table.parent?.fkColumn;
  const known = ["id", "valid_from", "valid_to", ...(fk ? [fk] : []), ...Object.keys(columns)];
  const typed = Object.entries(columns).filter(([, d]) => MUST[d.type]);
  const lines = [
    `IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
          RAISE EXCEPTION 'a row value for % must be an object', p_collection USING ERRCODE = '22023';
        END IF;`,
    `SELECT string_agg(k, ', ' ORDER BY k) INTO v_bad FROM jsonb_object_keys(p_value) AS k WHERE k NOT IN (${[...new Set(known)].map(lit).join(", ")});
        IF v_bad IS NOT NULL THEN
          RAISE EXCEPTION 'Unknown field: % (not a column of %)', v_bad, p_collection USING ERRCODE = '22023';
        END IF;`,
  ];
  if (fk) {
    const v = `p_value->${lit(fk)}`;
    lines.push(`IF p_value ? ${lit(fk)} AND jsonb_typeof(${v}) <> 'null'
           AND NOT (jsonb_typeof(${v}) = 'string' OR (jsonb_typeof(${v}) = 'number' AND (p_value->>${lit(fk)})::numeric = trunc((p_value->>${lit(fk)})::numeric))) THEN
          RAISE EXCEPTION '% must be an id: an integer', ${lit(fk)} USING ERRCODE = '22023';
        END IF;`);
  }
  if (typed.length) {
    const rows = typed.map(([col, d]) => {
      const v = `(p_value->${lit(col)})`;   // in parentheses: `::` binds tighter than `->`
      const [must, ok] = MUST[d.type]!;
      return `(${lit(col)}, CASE WHEN jsonb_typeof(${v}) <> 'null' AND NOT (${ok(v)}) THEN ${lit(`${col} must be ${must}`)} END)`;
    });
    lines.push(`SELECT string_agg(m, '; ' ORDER BY k) INTO v_bad FROM (VALUES
          ${rows.join(",\n          ")}) AS x(k, m) WHERE m IS NOT NULL;
        IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023'; END IF;`);
  }
  return [...lines, "RETURN;"].join("\n        ");
}

/** The SQL that gives and checks each of `docs`' columns: a function per document, `_delta_write_columns`, and `_delta_assert_fields`. */
export function compileColumns(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_write_columns(p_def _delta_docs, p_coll TEXT, p_columns_def JSONB)
RETURNS JSONB AS $$
BEGIN
${prefixDispatch(docs, (d) => `${columnsFunction(d.prefix)}(p_coll, p_columns_def)`, noDoc("p_def.prefix"))}
END;
$$ LANGUAGE plpgsql STABLE;`;

  // each collection's sets of columns: all of them, and each document's own
  const branches = Object.entries(schema.tables).map(([coll, table]) => {
    const sets = new Map<string, Record<string, ColumnDef>>([[JSON.stringify(table.columns), table.columns]]);
    for (const doc of docs) {
      const named = doc.columns?.[coll];
      if (!named) continue;
      const own = Object.fromEntries(Object.entries(table.columns).filter(([c]) => named.includes(c)));
      sets.set(JSON.stringify(own), own);
    }
    const fk = table.parent?.fkColumn;
    return `    WHEN ${lit(coll)} THEN
      IF p_parent_fk IS NOT DISTINCT FROM ${fk ? lit(fk) : "NULL"} THEN
${[...sets.values()].map((cols) => `        IF p_columns = ${asStored(cols)} THEN
        ${checksOf(table, cols)}
        END IF;`).join("\n")}
      END IF;`;
  });
  const checks = `CREATE OR REPLACE FUNCTION _delta_assert_fields(p_collection TEXT, p_columns JSONB, p_parent_fk TEXT, p_value JSONB)
RETURNS void AS $$
DECLARE
  v_bad TEXT;
BEGIN
${caseOf("p_collection", branches, "NULL;")}
  -- another set of columns (a walk's, another version's): by the columns given
  PERFORM _delta_assert_fields_declared(p_collection, p_columns, p_parent_fk, p_value);
END;
$$ LANGUAGE plpgsql IMMUTABLE;`;
  return [...docs.map((d) => columnsOf(schema, d)), dispatch, checks, ""].join("\n\n");
}
