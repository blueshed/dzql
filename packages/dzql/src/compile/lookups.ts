/**
 * Compiled lookups: a collection's definition, its table's serial, and a
 * document read as it stood. What the write, the reads and the ledger still
 * looked up at run time -- `_delta_collections` for a collection's table,
 * parent and columns, a table's sequence by its name, the framework's read as
 * it stood -- written from the definitions.
 *
 * `compileLookups(schema, docs)` writes:
 * - `_delta_collection(key)`: each collection's definition, as generateSql
 *   records it in `_delta_collections`, written in; any other key the
 *   framework's (`_delta_collection_framework`);
 * - `_delta_serial_new(table, id)` and `_delta_serial_past(table, id)`: each
 *   table's sequence named, read or moved as the framework's do (as the
 *   functions' owner, for a caller with the table's privilege), any other
 *   table the framework's;
 * - `_delta_find_doc(name)`: the document a name is of, by the longest prefix
 *   it starts with, as generateSql records it in `_delta_docs`, written in;
 *   any other name the framework's (`_delta_find_doc_framework`);
 * - `delta_open_at(name, at)`: each compiled document to its own read as it
 *   stood (`dzql_open_at__<slug>`), any other to `_delta_open_at_framework`.
 */
import { q, type DocDef, type Schema } from "@blueshed/delta/backend";
import { findCascadeOn } from "../postgres/sql";
import { lit, openAtFunction } from "./opens";

/** The caller, as the framework's serials ask: the role set, else the session's. */
const CALLER = "COALESCE(NULLIF(current_setting('role'), 'none'), session_user)";

/** The search path a definer function runs with: the schemas applied in, and pg_temp last (as the framework's serials). */
const searchPath = (signature: string) => `DO $$
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
  CASE p_key
${tables.map(([key, t]) => {
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
  }).join("\n")}
    ELSE RETURN _delta_collection_framework(p_key);
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;

  const serialNew = `CREATE OR REPLACE FUNCTION _delta_serial_new(p_table TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  v_new BOOLEAN;
BEGIN
  CASE p_table
${tables.map(([, t]) => `    WHEN ${lit(t.name)} THEN
      IF NOT has_table_privilege(${CALLER}, p_table, 'SELECT') THEN RETURN FALSE; END IF;
      SELECT p_id >= last_value + is_called::int INTO v_new FROM ${q(`seq_${t.name}`)};
      RETURN v_new;`).join("\n")}
    ELSE RETURN _delta_serial_new_framework(p_table, p_id);
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
${searchPath("_delta_serial_new(text, bigint)")}`;

  const serialPast = `CREATE OR REPLACE FUNCTION _delta_serial_past(p_table TEXT, p_id BIGINT)
RETURNS void AS $$
BEGIN
  CASE p_table
${tables.map(([, t]) => `    WHEN ${lit(t.name)} THEN
      IF p_id > 9007199254740991 OR NOT has_table_privilege(${CALLER}, p_table, 'INSERT') THEN RETURN; END IF;
      PERFORM setval(${lit(`seq_${t.name}`)}, p_id) FROM ${q(`seq_${t.name}`)} WHERE p_id >= last_value + is_called::int;`).join("\n")}
    ELSE PERFORM _delta_serial_past_framework(p_table, p_id);
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
${searchPath("_delta_serial_past(text, bigint)")}`;

  // longest first, as the framework's ORDER BY length(prefix) DESC: a name is of the longest prefix it starts with
  const byLength = [...docs].sort((a, b) => b.prefix.length - a.prefix.length || (a.prefix < b.prefix ? -1 : 1));
  const findDoc = `CREATE OR REPLACE FUNCTION _delta_find_doc(p_doc_name TEXT)
RETURNS _delta_docs AS $$
BEGIN
${byLength.map((d) => {
    const row = { prefix: d.prefix, root_collection: d.root, include: d.include, scope: d.scope, implied: !!d.implied, held: d.columns ?? {} };
    return `  IF starts_with(p_doc_name, ${lit(d.prefix)}) THEN RETURN jsonb_populate_record(null::_delta_docs, ${lit(JSON.stringify(row))}::jsonb); END IF;`;
  }).join("\n")}
  RETURN _delta_find_doc_framework(p_doc_name);
END;
$$ LANGUAGE plpgsql STABLE;`;

  const openAt = `CREATE OR REPLACE FUNCTION delta_open_at(p_doc_name TEXT, p_at TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_def _delta_docs := _delta_find_doc(p_doc_name);
BEGIN
  CASE v_def.prefix
${docs.map((d) => `    WHEN ${lit(d.prefix)} THEN RETURN ${openAtFunction(d.prefix)}(p_doc_name, p_at);`).join("\n")}
    ELSE RETURN _delta_open_at_framework(p_doc_name, p_at);   -- a name no document compiled here holds (none at all: the framework refuses it)
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;

  return [collection, findDoc, serialNew, serialPast, openAt, ""].join("\n\n");
}
