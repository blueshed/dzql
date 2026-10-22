/**
 * Lookups: a collection's definition, its table's serial, and a document read as it stood, written
 * from the definitions.
 *
 * `compileLookups(schema, docs)` writes:
 * - `_delta_collection(key)`: each collection's definition, as generateSql records it in
 *   `_delta_collections`; NULL fields for a key of none;
 * - `_delta_serial_new(table, id)` and `_delta_serial_past(table, id)`: each table's sequence read
 *   or moved, as the functions' owner, for a caller with the table's privilege, never past
 *   `SERIAL_BOUND`; for a table there is not, no id is new and nothing moves;
 * - `_delta_find_doc(name)`: the document a name is of, by the longest prefix it starts with; NULL
 *   for a name no document has;
 * - `delta_open_at(name, at)`: each document to its own read as it stood (`dzql_open_at__<slug>`),
 *   refusing a name no document has.
 */
import { q, type DocDef, type Schema } from "@blueshed/delta/backend";
import { findCascadeOn, seqOf } from "../postgres/sql";
import { lit, noDoc, openAtFunction, caseOf, prefixDispatch } from "./opens";

/**
 * The furthest an add's named id moves a serial: 2^53 - 1 less 2^32. An add may name any
 * id up to 2^53 - 1, and is kept; but a serial moved to 2^53 - 1 would mint 2^53 next, which no
 * path can name, and the table's new rows could never be written again. Past the bound, the
 * serial stops at it, 2^32 ids from the end: an id named past it is not one the serial hands out
 * (`_delta_serial_new` answers it new again once its row is gone), and `_delta_next_id` refuses
 * a mint past 2^53 - 1.
 */
export const SERIAL_BOUND = 9007194959773695;

/** The caller: the role set, else the session's. */
const CALLER = "COALESCE(NULLIF(current_setting('role'), 'none'), session_user)";

/** The search path a definer function runs with: the schemas applied in, and pg_temp last. */
export const searchPath = (signature: string) => `DO $$
DECLARE
  v_path TEXT := COALESCE((SELECT string_agg(quote_ident(s), ', ') FROM unnest(current_schemas(false)) AS s), 'public') || ', pg_temp';
BEGIN
  EXECUTE format('ALTER FUNCTION ${signature} SET search_path = %s', v_path);
END $$;`;

export function compileLookups(schema: Schema, docs: DocDef[]): string {
  const tables = Object.entries(schema.tables);

  const collection = `CREATE OR REPLACE FUNCTION _delta_collection(p_key TEXT)
RETURNS _delta_collections AS $$
BEGIN
${caseOf("p_key", tables.map(([key, t]) => {
    const row = {
      collection_key: key,
      table_name: t.name,
      columns_def: t.columns,
      parent_collection: t.parent?.collection ?? null,
      parent_fk: t.parent?.fkColumn ?? null,
      temporal: t.temporal,
      cascade_on: findCascadeOn(key, schema),
    };
    return `    WHEN ${lit(key)} THEN RETURN jsonb_populate_record(null::_delta_collections, ${lit(JSON.stringify(row))}::jsonb);`;
  }), "RETURN NULL;   -- a collection there is not")}
END;
$$ LANGUAGE plpgsql STABLE;`;

  const serialNew = `CREATE OR REPLACE FUNCTION _delta_serial_new(p_table TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  v_new BOOLEAN;
BEGIN
${caseOf("p_table", tables.map(([, t]) => `    WHEN ${lit(t.name)} THEN
      IF NOT has_table_privilege(${CALLER}, p_table, 'SELECT') THEN RETURN FALSE; END IF;
      SELECT p_id >= last_value + is_called::int INTO v_new FROM ${q(seqOf(t.name))};
      RETURN v_new;`), "RETURN FALSE;   -- a table there is not: no id is new")}
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
${searchPath("_delta_serial_new(text, bigint)")}`;

  // past the bound, the serial moves to the bound alone: 2^32 ids are left to mint, whatever id an add named
  const serialPast = `CREATE OR REPLACE FUNCTION _delta_serial_past(p_table TEXT, p_id BIGINT)
RETURNS void AS $$
DECLARE
  v_to BIGINT := LEAST(p_id, ${SERIAL_BOUND});
BEGIN
${caseOf("p_table", tables.map(([, t]) => `    WHEN ${lit(t.name)} THEN
      IF p_id > 9007199254740991 OR NOT has_table_privilege(${CALLER}, p_table, 'INSERT') THEN RETURN; END IF;
      PERFORM setval(${lit(seqOf(t.name))}, v_to) FROM ${q(seqOf(t.name))} WHERE v_to >= last_value + is_called::int;`), "NULL;   -- a table there is not: nothing to move")}
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
${searchPath("_delta_serial_past(text, bigint)")}`;

  // longest first: a name is of the longest prefix it starts with
  const byLength = [...docs].sort((a, b) => b.prefix.length - a.prefix.length || (a.prefix < b.prefix ? -1 : 1));
  const findDoc = `CREATE OR REPLACE FUNCTION _delta_find_doc(p_doc_name TEXT)
RETURNS _delta_docs AS $$
BEGIN
${byLength.map((d) => {
    const row = { prefix: d.prefix, root_collection: d.root, include: d.include, scope: d.scope, implied: !!d.implied, held: d.columns ?? {}, owns: d.owns };
    return `  IF starts_with(p_doc_name, ${lit(d.prefix)}) THEN RETURN jsonb_populate_record(null::_delta_docs, ${lit(JSON.stringify(row))}::jsonb); END IF;`;
  }).join("\n")}
  RETURN NULL;   -- a name no document holds
END;
$$ LANGUAGE plpgsql STABLE;`;

  const openAt = `CREATE OR REPLACE FUNCTION delta_open_at(p_doc_name TEXT, p_at TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_def _delta_docs := _delta_find_doc(p_doc_name);
BEGIN
${prefixDispatch(docs, (d) => `${openAtFunction(d.prefix)}(p_doc_name, p_at)`, noDoc("p_doc_name"), "v_def.prefix")}
END;
$$ LANGUAGE plpgsql STABLE;`;

  return [collection, findDoc, serialNew, serialPast, openAt, ""].join("\n\n");
}
