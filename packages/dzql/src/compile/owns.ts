/**
 * Compiled ownership: a document's `owns` as a path (delta's `./paths`), compiled into its own
 * function, `dzql_owns__<slug>(name, person)`: does the path reach the person from the name's row?
 * The name's values are read as its scope reads them (`scopeOf`); a single document's root row is
 * read at its current version; the path is lowered by delta's `pathSql`, the same SQL SQLite runs.
 * The listener asks it where delta asks `owns` (open, write, walk, before each change is told).
 *
 * And `_delta_keeps_reach(def, name)`, which `delta_apply` asks once a write's ops are applied: a
 * write through a document with a path must leave it reaching the writer (`app.user_id`), or its
 * root row gone -- a row is never handed away (403). A document with no path, or a write with no
 * person, keeps it.
 */
import { q, type DocDef, type Schema } from "@blueshed/delta/backend";
import { assertPath, parsePath, pathSql } from "@blueshed/delta/paths";
import { lit, named, need, scopeOf, caseOf, WHOLE } from "./opens";

/** A document's ownership function: `dzql_owns__<slug>`. */
export const ownsFunction = (prefix: string): string => named("owns", prefix);

type Pathed = DocDef & { owns: string };

/** One document's ownership function. */
function ownsOf(schema: Schema, doc: Pathed): string {
  assertPath(doc, schema);
  const root = need(schema, doc, doc.root);
  const scope = scopeOf(schema, doc);
  const scoped = Object.keys(doc.scope ?? {}).length > 0;
  const current = root.temporal ? " AND r.valid_to IS NULL" : "";
  // an @field: the name's value for a key it gives, else (no scope) the single row's column
  const start = (field: string): string => {
    if (scoped) {
      const v = scope.values[field]!;
      return `(CASE WHEN ${v} ~ '${WHOLE}' THEN ${v}::BIGINT END)`;
    }
    return field === "id" ? "v_id" : `(SELECT r.${q(field)} FROM ${q(root.name)} r WHERE r.id = v_id${current})`;
  };
  const reaches = pathSql(parsePath(doc.owns), schema, { start, person: "p_person" });
  return `CREATE OR REPLACE FUNCTION ${ownsFunction(doc.prefix)}(p_name TEXT, p_person BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  p_at     TIMESTAMPTZ;
  v_single BOOLEAN;
  v_id     BIGINT;
  ${scope.declare.join("\n  ")}
BEGIN
  ${scope.body}
  RETURN COALESCE(${reaches}, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The ownership functions of `docs` with a path, and `_delta_keeps_reach` for every one. */
export function compileOwns(schema: Schema, docs: DocDef[]): string {
  const pathed = docs.filter((d): d is Pathed => d.owns !== undefined);
  const keeps = (d: Pathed) => {
    const root = need(schema, d, d.root);
    const rest = Object.keys(d.scope ?? {}).length === 0 ? `substring(p_doc_name FROM ${d.prefix.length + 1})` : null;
    // a single document whose root row is gone handed nothing away
    const gone = rest ? `${rest} ~ '${WHOLE}' AND NOT EXISTS (SELECT 1 FROM ${q(root.name)} r WHERE r.id = ${rest}::BIGINT${root.temporal ? " AND r.valid_to IS NULL" : ""}) OR ` : "";
    return `    WHEN ${lit(d.prefix)} THEN RETURN ${gone}${ownsFunction(d.prefix)}(p_doc_name, v_person);`;
  };
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_keeps_reach(p_def _delta_docs, p_doc_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_user   TEXT := current_setting('app.user_id', true);
  v_person BIGINT := CASE WHEN v_user ~ '${WHOLE}' THEN v_user::BIGINT END;
BEGIN
  IF v_person IS NULL THEN RETURN TRUE; END IF;
${caseOf("p_def.prefix", pathed.map(keeps), "RETURN TRUE;")}
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...pathed.map((d) => ownsOf(schema, d)), dispatch, ""].join("\n\n");
}
