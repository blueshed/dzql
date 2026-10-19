/**
 * Write scope: may a document write a row? You may write what you may read: every row-addressed
 * op of a write is asked first (`delta_apply`, `_delta_row_in_scope`), and a row the document may
 * not read is answered as one that is not there.
 *
 * `compileInScope(schema, docs)` writes `dzql_in_scope__<slug>(name, collection, id)` for each
 * document. A list document holds its included collections whole and its root rows by the name's
 * conditions; a single document holds a row whose parent chain, walked up through the tables as
 * they stand, reaches its root, which meets the rest of its name's scope. `_delta_row_in_scope`
 * sends each document to its own, and refuses a name no document has (`no doc def for`).
 */
import { q, type DocDef, type Schema } from "@blueshed/delta/backend";
import { lit, named, need, noDoc, scopeOf, currentOnly, prefixDispatch } from "./opens";

/** A document's write-scope function: `dzql_in_scope__<slug>`. */
export const inScopeFunction = (prefix: string): string => named("in_scope", prefix);


/** One document's write-scope function. */
function inScopeOf(schema: Schema, doc: DocDef): string {
  const root = need(schema, doc, doc.root);
  const scope = scopeOf(schema, doc);   // a value its columns cannot take: refused
  const conds = scope.conds ? ` AND ${scope.conds}` : "";
  // the root row of a single document: its id, and (where the name scopes more than the id) the rest of its scope
  const others = Object.keys(doc.scope ?? {}).some((k) => k !== "id");
  const rootMeets = (id: string) => others
    ? `COALESCE(${id} = v_id, FALSE) AND EXISTS (SELECT 1 FROM ${q(root.name)} t WHERE t.id = v_id${currentOnly(root, "t")}${conds})`
    : `COALESCE(${id} = v_id, FALSE)`;
  const included = new Set(doc.include);

  const singles = Object.entries(schema.tables).map(([coll, table]) => {
    if (coll === doc.root) return `      WHEN ${lit(coll)} THEN RETURN ${rootMeets("p_id")};`;
    // unparented: held whole where included; else it ends a chain short of the root
    if (!table.parent) return `      WHEN ${lit(coll)} THEN RETURN ${included.has(coll) ? "TRUE" : "FALSE"};`;
    let id = "p_id";
    let t = table;
    for (let depth = 0; depth < 32; depth++) {
      id = `(SELECT x.${q(t.parent!.fkColumn)} FROM ${q(t.name)} x WHERE x.id = ${id}${currentOnly(t, "x")})`;
      const parentKey = t.parent!.collection;
      if (parentKey === doc.root) return `      WHEN ${lit(coll)} THEN RETURN ${rootMeets(id)};`;
      const parent = schema.tables[parentKey];
      if (!parent?.parent) return `      WHEN ${lit(coll)} THEN RETURN FALSE;`;   // the chain ends short of the root
      t = parent;
    }
    return `      WHEN ${lit(coll)} THEN RETURN FALSE;`;
  });

  return `CREATE OR REPLACE FUNCTION ${inScopeFunction(doc.prefix)}(p_name TEXT, p_coll TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  p_at     TIMESTAMPTZ;
  v_single BOOLEAN;
  v_id     BIGINT;
  ${scope.declare.join("\n  ")}
BEGIN
  IF p_id IS NULL THEN RETURN FALSE; END IF;
  ${scope.body}
  IF NOT v_single THEN
    -- a list holds its included collections whole; its root rows by the name's conditions
    IF p_coll IS DISTINCT FROM ${lit(doc.root)} THEN RETURN TRUE; END IF;
    RETURN EXISTS (SELECT 1 FROM ${q(root.name)} t WHERE t.id = p_id${currentOnly(root, "t")}${conds});
  END IF;
  CASE p_coll
${singles.join("\n")}
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The SQL that answers a write's scope for each of `docs`: a function per document, and `_delta_row_in_scope` sending each to its own. */
export function compileInScope(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_row_in_scope(p_def _delta_docs, p_doc_name TEXT, p_collection_key TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
${prefixDispatch(docs, (d) => `${inScopeFunction(d.prefix)}(p_doc_name, p_collection_key, p_id)`, noDoc("p_doc_name"))}
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...docs.map((d) => inScopeOf(schema, d)), dispatch, ""].join("\n\n");
}
