/**
 * Holds: does a document hold a row? Asked of every open document by every write (`_delta_holders`,
 * the fan-out), on the row as it was before the write and as it is after.
 *
 * `compileHolds(schema, docs)` writes `dzql_holds__<slug>(name, collection, row)` for each
 * document: the collections it holds, its name's conditions tested on the row's own values
 * (`scopeOf`; a name its columns cannot take holds nothing), a temporal row not told to a document
 * named with a time past, and an included row's chain of parents up to the root, as written
 * lookups -- a list's, to a root row its name's conditions admit. `_delta_doc_holds` sends each
 * document to its own, and refuses a name no document has.
 */
import { q, type DocDef, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { hangsFrom, lit, named, need, noDoc, scopeOf, currentOnly, prefixDispatch } from "./opens";

/** A document's holds function: `dzql_holds__<slug>`. */
export const holdsFunction = (prefix: string): string => named("holds", prefix);


/**
 * The id of the root row an included row hangs from, as `_delta_chain_root`
 * finds it: its parent key, then each parent's, through the tables as they
 * stand; NULL where the chain ends short of the root. `first` reads the row's own parent key: from
 * the JSON row `p_row` here, from a row of the table where a policy asks (`compilePolicies`).
 */
export function chainRoot(schema: Schema, doc: DocDef, coll: string, first = (fk: string) => `(p_row->>${lit(fk)})::BIGINT`): string {
  let table = need(schema, doc, coll);
  let id = first(table.parent!.fkColumn);
  for (let depth = 0; depth < 32; depth++) {
    const parentKey = table.parent!.collection;
    if (parentKey === doc.root) return id;
    const parent = need(schema, doc, parentKey);
    if (!parent.parent) return "NULL::BIGINT";
    id = `(SELECT p.${q(parent.parent.fkColumn)} FROM ${q(parent.name)} p WHERE p.id = ${id}${currentOnly(parent, "p")})`;
    table = parent;
  }
  return "NULL::BIGINT";
}

/** One document's holds function. */
function holdsOf(schema: Schema, doc: DocDef): string {
  const root = need(schema, doc, doc.root);
  // a name its columns cannot take (one opened before a rule refused it) holds nothing
  const scope = scopeOf(schema, doc, () => "RETURN FALSE;");
  const colls = [doc.root, ...doc.include.filter((c) => c !== doc.root)];
  const pastTime = (table: ResolvedTable) => (table.temporal ? `\n      IF p_at <= now() THEN RETURN FALSE; END IF;` : "");
  const branches = colls.map((coll) => {
    const table = need(schema, doc, coll);
    if (coll === doc.root) {
      return `    WHEN ${lit(coll)} THEN${pastTime(table)}
      IF v_single AND (p_row->>'id')::BIGINT IS DISTINCT FROM v_id THEN RETURN FALSE; END IF;
      RETURN EXISTS (SELECT 1 FROM jsonb_populate_record(null::${q(root.name)}, p_row) t WHERE ${scope.conds || "TRUE"});`;
    }
    if (!table.parent) return `    WHEN ${lit(coll)} THEN${pastTime(table)}\n      RETURN TRUE;`;
    // a list holds a row that hangs from its root only under a root row it admits; one that hangs from none, whole
    const list = scope.conds && hangsFrom(schema, coll, doc.root)
      ? `RETURN EXISTS (SELECT 1 FROM ${q(root.name)} t WHERE t.id = ${chainRoot(schema, doc, coll)}${currentOnly(root, "t")}${scope.conds ? ` AND ${scope.conds}` : ""});`
      : "RETURN TRUE;";
    return `    WHEN ${lit(coll)} THEN${pastTime(table)}
      IF NOT v_single THEN ${list} END IF;
      RETURN ${chainRoot(schema, doc, coll)} IS NOT DISTINCT FROM v_id;`;
  });
  return `CREATE OR REPLACE FUNCTION ${holdsFunction(doc.prefix)}(p_name TEXT, p_coll TEXT, p_row JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  p_at     TIMESTAMPTZ;
  v_single BOOLEAN;
  v_id     BIGINT;
  ${scope.declare.join("\n  ")}
BEGIN
  IF p_row IS NULL OR p_coll NOT IN (${colls.map(lit).join(", ")}) THEN RETURN FALSE; END IF;
  ${scope.body}
  CASE p_coll
${branches.join("\n")}
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The SQL that answers who holds a row for each of `docs`: a function per document, and `_delta_doc_holds` sending each to its own. */
export function compileHolds(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_doc_holds(p_def _delta_docs, p_doc_name TEXT, p_coll TEXT, p_row JSONB)
RETURNS BOOLEAN AS $$
BEGIN
${prefixDispatch(docs, (d) => `${holdsFunction(d.prefix)}(p_doc_name, p_coll, p_row)`, noDoc("p_doc_name"))}
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...docs.map((d) => holdsOf(schema, d)), dispatch, ""].join("\n\n");
}
