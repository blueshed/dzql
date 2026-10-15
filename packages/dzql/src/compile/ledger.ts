/**
 * Compiled ledger reads: what the ledger reads to write an entry's inverse and
 * to guard a walk of it (undo, redo). The framework read the document whole
 * (`_delta_open(name, TRUE)`), a field's type and the rows beyond the document
 * from the definitions at run time; here each is written from them.
 *
 * `compileLedger(schema, docs)` writes:
 * - `dzql_open_whole__<slug>(name)` for each document: its open with every
 *   column of every row, whatever columns it names (`readOf`, whole), and
 *   `_delta_open` itself, sending each compiled document to its own open, shown
 *   (`dzql_open__<slug>`) or whole, and any other to the framework's
 *   (`_delta_open_framework`);
 * - `_delta_same(collection, field, a, b)`: two values of a field the same, a
 *   time by the instant it names. The field's type is the writing process's
 *   (`delta.declared`), else the schema's, written in for each collection;
 *   any other collection is the framework's (`_delta_same_framework`);
 * - `_delta_row_standing(collection, id)`: a row as it stands, as `{row}`, for
 *   every collection of the schema; any other the framework's.
 */
import { q, type DocDef, type Schema } from "@blueshed/delta/backend";
import { lit, openFunction, openWholeFunction, readOf } from "./opens";

/** The SQL the ledger reads by, for `schema` and each of `docs`. */
export function compileLedger(schema: Schema, docs: DocDef[]): string {
  const whole = docs.map((d) => readOf(schema, d, false, true));

  const open = `CREATE OR REPLACE FUNCTION _delta_open(p_doc_name TEXT, p_whole BOOLEAN)
RETURNS JSONB AS $$
DECLARE
  v_def _delta_docs := _delta_find_doc(p_doc_name);
BEGIN
  CASE v_def.prefix
${docs.map((d) => `    WHEN ${lit(d.prefix)} THEN RETURN CASE WHEN p_whole THEN ${openWholeFunction(d.prefix)}(p_doc_name) ELSE ${openFunction(d.prefix)}(p_doc_name) END;`).join("\n")}
    ELSE RETURN _delta_open_framework(p_doc_name, p_whole);   -- a name no document compiled here holds (none at all: the framework refuses it)
  END CASE;
END;
$$ LANGUAGE plpgsql;`;

  const colls = Object.entries(schema.tables);
  const same = `CREATE OR REPLACE FUNCTION _delta_same(p_coll TEXT, p_field TEXT, a JSONB, b JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  v_declared JSONB;
  v_type     TEXT;
BEGIN
  IF jsonb_typeof(a) = 'string' AND jsonb_typeof(b) = 'string' THEN
    CASE p_coll
${colls.map(([coll, t]) => {
    const times = Object.entries(t.columns).filter(([, d]) => d.type === "timestamptz").map(([c]) => c);
    return `      WHEN ${lit(coll)} THEN
        v_declared := NULLIF(current_setting('delta.declared', true), '')::jsonb -> ${lit(coll)};
        v_type := CASE WHEN v_declared IS NOT NULL THEN v_declared -> p_field ->> 'type'${times.length ? ` WHEN p_field IN (${times.map(lit).join(", ")}) THEN 'timestamptz'` : ""} END;`;
  }).join("\n")}
      ELSE RETURN _delta_same_framework(p_coll, p_field, a, b);
    END CASE;
    IF v_type = 'timestamptz' THEN RETURN (a #>> '{}')::timestamptz = (b #>> '{}')::timestamptz; END IF;
  END IF;
  RETURN COALESCE(a, 'null'::jsonb) = COALESCE(b, 'null'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;`;

  const standing = `CREATE OR REPLACE FUNCTION _delta_row_standing(p_coll TEXT, p_id BIGINT)
RETURNS JSONB AS $$
BEGIN
  CASE p_coll
${colls.map(([coll, t]) => `    WHEN ${lit(coll)} THEN RETURN jsonb_build_object('row', (SELECT _delta_strip_temporal(to_jsonb(t.*)) FROM ${q(t.temporal ? `current_${t.name}` : t.name)} t WHERE t.id = p_id));`).join("\n")}
    ELSE RETURN _delta_row_standing_framework(p_coll, p_id);
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;

  return [...whole, open, same, standing, ""].join("\n\n");
}
