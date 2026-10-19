/**
 * Root check: is a single document's root row there now, meeting the whole of its name's scope?
 * Asked before each op of a write (`delta_apply`), so a document whose root is gone takes no writes.
 *
 * `compileRootThere(schema, docs)` writes `dzql_root_there__<slug>(name, id)` for each document:
 * the name's values read and checked (`scopeOf`), and the root's standing rows asked with its
 * conditions as typed SQL. `_delta_root_there` sends each document to its own, and refuses a name
 * no document has.
 */
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { lit, named, need, noDoc, scopeOf, standingRows, prefixDispatch } from "./opens";

/** A document's root check: `dzql_root_there__<slug>`. */
export const rootThereFunction = (prefix: string): string => named("root_there", prefix);

/** One document's root check. */
function rootThereOf(schema: Schema, doc: DocDef): string {
  const root = need(schema, doc, doc.root);
  const rows = standingRows(root);   // the root's rows as they stand
  const head = `CREATE OR REPLACE FUNCTION ${rootThereFunction(doc.prefix)}(p_name TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$`;
  if (Object.keys(doc.scope ?? {}).length === 0) {
    // no scope: a name with an id is that row, one without, any
    return `${head}
DECLARE
  v_rest TEXT := substring(p_name FROM ${doc.prefix.length + 1});
BEGIN
  IF v_rest = '' THEN RETURN EXISTS (SELECT 1 FROM ${rows} t WHERE t.id = p_id); END IF;
  RETURN EXISTS (SELECT 1 FROM ${rows} t WHERE t.id = p_id AND t.id = v_rest::BIGINT);
END;
$$ LANGUAGE plpgsql STABLE;`;
  }
  const scope = scopeOf(schema, doc);
  return `${head}
DECLARE
  ${scope.declare.join("\n  ")}
BEGIN
  ${scope.checks}
  RETURN EXISTS (SELECT 1 FROM ${rows} t WHERE t.id = p_id${scope.conds ? ` AND ${scope.conds}` : ""});
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The SQL that answers whether each of `docs`' root is there: a function per document, and `_delta_root_there` sending each to its own. */
export function compileRootThere(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_root_there(p_def _delta_docs, p_doc_name TEXT, p_scope JSONB, p_view TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
${prefixDispatch(docs, (d) => `${rootThereFunction(d.prefix)}(p_doc_name, p_id)`, noDoc("p_doc_name"))}
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...docs.map((d) => rootThereOf(schema, d)), dispatch, ""].join("\n\n");
}
