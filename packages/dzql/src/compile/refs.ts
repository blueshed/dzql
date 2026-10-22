/**
 * References: the columns that name a row of another collection (delta's `refs`), held at the end
 * of a write, written from the schema.
 *
 * `compileRefs(schema)` writes `_delta_refs_hold(touched)`, which `delta_apply` asks once its ops
 * are applied (a walk's too), of the rows the write changed (`_delta_tell`'s touches, a row carried
 * along not among them), each by its first touch: what it was before the write. For each:
 * - a row there now, of a collection with `refs`: each such column whose value the write gave it
 *   (an add's, or one it changed) names a current row of its collection, else
 *   `Row not found: <coll>/<id> -- <coll>/<id>'s <column> names it` (P0002, 404);
 * - a row not there now, of a collection others name (`namedBy`, by collection then column): no
 *   current row names it, else `Still named: <coll>/<id> is <coll>/<id>'s <column> -- change or
 *   remove that first` (23503, 409), the first such row by id.
 * In delta's words, in the order SQLite's write path asks them (`refsHold` in delta's
 * `sqlite/write.ts`). It reads as the functions' owner (SECURITY DEFINER), so a row the writer may
 * not read still holds what it names. With no `refs` in the schema it asks nothing.
 */
import { q, type Schema } from "@blueshed/delta/backend";
import { caseOf, lit, standingRows } from "./opens";
import { searchPath } from "./lookups";

/** `_delta_refs_hold` for every collection of `schema` that names another, or is named. */
export function compileRefs(schema: Schema): string {
  const branches = Object.entries(schema.tables).flatMap(([coll, t]) => {
    if (!t.refs && !t.namedBy) return [];
    const names = (t.refs ?? []).map((ref) => {
      const v = `v_now->${lit(ref.column)}`;
      return `          IF jsonb_typeof(${v}) = 'number' AND ${v} IS DISTINCT FROM v_t.was->${lit(ref.column)}
             AND NOT EXISTS (SELECT 1 FROM ${standingRows(schema.tables[ref.collection]!)} r WHERE r.id = (${v} #>> '{}')::bigint) THEN
            RAISE EXCEPTION 'Row not found: %/% -- %/%''s % names it', ${lit(ref.collection)}, ${v} #>> '{}', ${lit(coll)}, v_t.id, ${lit(ref.column)} USING ERRCODE = 'P0002';
          END IF;`;
    });
    const named = (t.namedBy ?? []).map((by) => `          SELECT r.id INTO v_by FROM ${standingRows(schema.tables[by.collection]!)} r WHERE r.${q(by.column)} = v_t.id ORDER BY r.id LIMIT 1;
          IF v_by IS NOT NULL THEN
            RAISE EXCEPTION 'Still named: %/% is %/%''s % -- change or remove that first', ${lit(coll)}, v_t.id, ${lit(by.collection)}, v_by, ${lit(by.column)} USING ERRCODE = '23503';
          END IF;`);
    return [`      WHEN ${lit(coll)} THEN
        SELECT _delta_strip_temporal(to_jsonb(r.*)) INTO v_now FROM ${standingRows(t)} r WHERE r.id = v_t.id;${names.length ? `
        IF v_now IS NOT NULL THEN
${names.join("\n")}
        END IF;` : ""}${named.length ? `
        IF v_now IS NULL THEN
${named.join("\n")}
        END IF;` : ""}`];
  });
  const body = branches.length
    ? `  FOR v_t IN
    SELECT t->>'coll' AS coll, (t->>'id')::bigint AS id, (array_agg(t->'was' ORDER BY n))[1] AS was
      FROM jsonb_array_elements(COALESCE(p_touched, '[]'::jsonb)) WITH ORDINALITY AS e(t, n)
     WHERE NOT COALESCE((t->>'carried')::boolean, FALSE)
     GROUP BY 1, 2 ORDER BY min(n)
  LOOP
${caseOf("v_t.coll", branches, "NULL;   -- a collection that names none, and none names", { indent: "    " })}
  END LOOP;`
    : "  NULL;   -- no collection names another";
  const refsOf = `CREATE OR REPLACE FUNCTION _delta_refs_of(p_coll TEXT)
RETURNS JSONB AS $$
BEGIN
${caseOf("p_coll", Object.entries(schema.tables).filter(([, t]) => t.refs).map(([coll, t]) => `    WHEN ${lit(coll)} THEN RETURN ${lit(JSON.stringify(Object.fromEntries(t.refs!.map((r) => [r.column, r.collection]))))}::jsonb;`), "RETURN '{}'::jsonb;   -- a collection that names none by refs")}
END;
$$ LANGUAGE plpgsql IMMUTABLE;`;
  return `${refsOf}

CREATE OR REPLACE FUNCTION _delta_refs_hold(p_touched JSONB)
RETURNS void AS $$
DECLARE
  v_t   RECORD;
  v_now JSONB;
  v_by  BIGINT;
BEGIN
${body}
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
${searchPath("_delta_refs_hold(jsonb)")}
`;
}
