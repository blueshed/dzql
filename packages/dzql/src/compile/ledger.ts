/**
 * Ledger reads: what the ledger reads to write an entry's inverse and to guard a walk of it (undo,
 * redo), written from the definitions.
 *
 * `compileLedger(schema, docs)` writes:
 * - `dzql_open_whole__<slug>(name)` for each document: its open with every column of every row,
 *   whatever columns it names (`readOf`, whole), and `_delta_open`, sending each document to its own
 *   open, shown (`dzql_open__<slug>`) or whole, and refusing a name no document has;
 * - `_delta_same(collection, field, a, b)`: two values of a field the same, a time by the instant it
 *   names. The field's type is the writing process's (`delta.declared`), else the schema's, written
 *   in for each collection; a collection there is not, the same as JSON;
 * - `_delta_row_standing(collection, id)`: a row as it stands, as `{row}`, for every collection of
 *   the schema; NULL for one there is not.
 */
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { lit, noDoc, openFunction, openWholeFunction, readOf, standingRows, prefixDispatch, caseOf } from "./opens";

/** The SQL the ledger reads by, for `schema` and each of `docs`. */
export function compileLedger(schema: Schema, docs: DocDef[]): string {
  const whole = docs.map((d) => readOf(schema, d, false, true));

  const open = `CREATE OR REPLACE FUNCTION _delta_open(p_doc_name TEXT, p_whole BOOLEAN)
RETURNS JSONB AS $$
DECLARE
  v_def _delta_docs := _delta_find_doc(p_doc_name);
BEGIN
${prefixDispatch(docs, (d) => `CASE WHEN p_whole THEN ${openWholeFunction(d.prefix)}(p_doc_name) ELSE ${openFunction(d.prefix)}(p_doc_name) END`, noDoc("p_doc_name"), "v_def.prefix")}
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
${caseOf("p_coll", colls.map(([coll, t]) => {
    const times = Object.entries(t.columns).filter(([, d]) => d.type === "timestamptz").map(([c]) => c);
    return `      WHEN ${lit(coll)} THEN
        v_declared := NULLIF(current_setting('delta.declared', true), '')::jsonb -> ${lit(coll)};
        v_type := CASE WHEN v_declared IS NOT NULL THEN v_declared -> p_field ->> 'type'${times.length ? ` WHEN p_field IN (${times.map(lit).join(", ")}) THEN 'timestamptz'` : ""} END;`;
  }), "NULL;   -- a collection there is not: its values the same as JSON", { indent: "    " })}
    IF v_type = 'timestamptz' THEN RETURN (a #>> '{}')::timestamptz = (b #>> '{}')::timestamptz; END IF;
  END IF;
  RETURN COALESCE(a, 'null'::jsonb) = COALESCE(b, 'null'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;`;

  const standing = `CREATE OR REPLACE FUNCTION _delta_row_standing(p_coll TEXT, p_id BIGINT)
RETURNS JSONB AS $$
BEGIN
${caseOf("p_coll", colls.map(([coll, t]) => `    WHEN ${lit(coll)} THEN RETURN jsonb_build_object('row', (SELECT _delta_strip_temporal(to_jsonb(t.*)) FROM ${standingRows(t)} t WHERE t.id = p_id));`), "RETURN NULL;   -- a collection there is not")}
END;
$$ LANGUAGE plpgsql STABLE;`;

  return [...whole, open, same, standing, ""].join("\n\n");
}
