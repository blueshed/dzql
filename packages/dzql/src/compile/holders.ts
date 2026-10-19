/**
 * Fan-out: which open documents hold a row. Asked by every write of every row it touches, as the row
 * was before and as it is after (`_delta_holders`); what each is told follows from it.
 *
 * `compileHolders(schema, docs)` writes `_delta_holders`: for the row's collection, each document
 * that holds it in turn -- its prefix's lock, shared; its open names (by the root the row hangs from,
 * its chain written as lookups, where the document is one row of an unscoped definition; else every
 * open name of its prefix) and the writer's; each name its own prefix owns (not a longer prefix's)
 * and whose document holds the row (`dzql_holds__<slug>`). SECURITY DEFINER, with the search path it
 * was applied with and pg_temp last: who is told does not depend on what the writer may read.
 */
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { chainRoot, holdsFunction } from "./holds";
import { lit, need, caseOf } from "./opens";

/** One document's names that hold the row, for a collection it holds. */
function askOf(schema: Schema, docs: DocDef[], doc: DocDef, coll: string): string {
  const table = need(schema, doc, coll);
  const all = Object.keys(doc.scope ?? {}).length > 0 || (coll !== doc.root && !table.parent);
  const prefix = lit(doc.prefix);
  // a name a longer prefix starts is that document's: the longest prefix owns the name
  const longer = docs.filter((d) => d.prefix.length > doc.prefix.length && d.prefix.startsWith(doc.prefix));
  return `      -- ${doc.prefix}
${all ? "" : `      v_rid := ${coll === doc.root ? "(p_row->>'id')::BIGINT" : chainRoot(schema, doc, coll)};\n`}      PERFORM pg_advisory_xact_lock_shared(hashtext('_delta_hold'), hashtext(${prefix}));
      FOR v_cand IN
        SELECT doc_name FROM _delta_held WHERE ${all ? `starts_with(doc_name, ${prefix})` : `doc_name IN (${prefix}, ${prefix} || v_rid::text)`}
        UNION
        SELECT p_writer WHERE p_writer IS NOT NULL AND starts_with(p_writer, ${prefix})
      LOOP
        IF NOT (v_cand = ANY(v_names))
${longer.length ? `           AND NOT (${longer.map((d) => `starts_with(v_cand, ${lit(d.prefix)})`).join(" OR ")})\n` : ""}           AND ${holdsFunction(doc.prefix)}(v_cand, ${lit(coll)}, p_row) THEN
          v_names := v_names || v_cand;
        END IF;
      END LOOP;`;
}

/** The SQL that answers who holds a row: `_delta_holders`, each of `docs` asked by its own lookups. */
export function compileHolders(schema: Schema, docs: DocDef[]): string {
  const branches = Object.keys(schema.tables).flatMap((coll) => {
    const holding = docs.filter((d) => d.root === coll || d.include.includes(coll));
    return holding.length ? [`    WHEN ${lit(coll)} THEN\n${holding.map((d) => askOf(schema, docs, d, coll)).join("\n")}`] : [];
  });
  return `CREATE OR REPLACE FUNCTION _delta_holders(p_coll TEXT, p_row JSONB, p_writer TEXT)
RETURNS TEXT[] AS $$
DECLARE
  v_names TEXT[] := ARRAY[]::text[];
  v_rid   BIGINT;
  v_cand  TEXT;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'a delta write runs at READ COMMITTED, not %: a document opened while it ran would not be told of it',
      upper(current_setting('transaction_isolation')) USING ERRCODE = '0A000';
  END IF;
  IF p_row IS NULL THEN RETURN v_names; END IF;
${caseOf("p_coll", branches, "NULL;", { alone: "" })}${branches.length ? "\n" : ""}  RETURN v_names;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION _delta_holders(TEXT, JSONB, TEXT) SET search_path = %s, pg_temp', COALESCE(NULLIF(current_setting('search_path'), ''), 'public'));
END $$;
`;
}
