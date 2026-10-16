/**
 * Telling: what a document is told of a write. Asked by `_delta_tell` of the writer and of every
 * document that held a row the write touched, or holds it now.
 *
 * `compileTold(schema, docs)` writes `dzql_told__<slug>(name, rows)` for each document: whether
 * the name makes it one row (`scopeOf`), its root, the columns it shows of each collection it names
 * them for (with the row's id and parent key), and, for an implied document whose root leaves, the
 * empty root it opens with. `_delta_told` sends each document to its own, and refuses a name no
 * document has.
 */
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { impliedRoot, lit, named, need, noDoc, scopeOf } from "./opens";

/** A document's telling function: `dzql_told__<slug>`. */
export const toldFunction = (prefix: string): string => named("told", prefix);

/**
 * A row (SQL `row`) of collection (SQL `coll`) as the document shows it, as
 * `_delta_show` does: where it names the collection's columns, those, the id
 * and the parent key; else whole.
 */
function shown(schema: Schema, doc: DocDef, coll: string, row: string): string {
  const named = Object.entries(doc.columns ?? {});
  if (named.length === 0) return row;
  const branches = named.map(([c, cols]) => {
    const fk = schema.tables[c]?.parent?.fkColumn;
    const keep = [...new Set(["id", ...(fk ? [fk] : []), ...cols])].map(lit).join(", ");
    return `WHEN ${lit(c)} THEN COALESCE((SELECT jsonb_object_agg(f, v) FROM jsonb_each(${row}) AS e(f, v) WHERE f IN (${keep})), '{}'::jsonb)`;
  });
  return `(CASE WHEN jsonb_typeof(${row}) IS DISTINCT FROM 'object' THEN ${row} ELSE CASE ${coll} ${branches.join(" ")} ELSE ${row} END END)`;
}

/** One document's telling function. */
function toldOf(schema: Schema, doc: DocDef): string {
  const root = need(schema, doc, doc.root);
  const scope = scopeOf(schema, doc);   // a name its columns cannot take: refused
  const after = shown(schema, doc, "v_t->>'coll'", "v_t->'after'");
  const gone = doc.implied
    ? impliedRoot(root, doc, "(v_t->>'id')::BIGINT")
    : "'null'::jsonb";
  return `CREATE OR REPLACE FUNCTION ${toldFunction(doc.prefix)}(p_name TEXT, p_rows JSONB)
RETURNS JSONB AS $$
DECLARE
  p_at     TIMESTAMPTZ;
  v_single BOOLEAN;
  v_id     BIGINT;
  v_t      JSONB;
  v_told   JSONB := '[]'::jsonb;
  v_was    BOOLEAN;
  v_is     BOOLEAN;
  v_root   BOOLEAN;
  v_path   TEXT;
  ${scope.declare.join("\n  ")}
BEGIN
  ${scope.body}
  FOR v_t IN SELECT jsonb_array_elements(p_rows) LOOP
    v_was := (v_t->'before') ? p_name;
    v_is  := (v_t->'holders') ? p_name;
    CONTINUE WHEN NOT v_was AND NOT v_is;
    CONTINUE WHEN v_was AND v_is AND (v_t ? 'carried');   -- carried along, and its either way: unchanged for it
    v_root := v_single AND (v_t->>'coll') = ${lit(doc.root)};
    v_path := CASE WHEN v_root THEN _delta_build_path(v_t->>'coll') ELSE _delta_build_path(v_t->>'coll', v_t->>'id') END;
    IF v_was AND v_is THEN   -- stayed: what changed
      v_told := v_told || COALESCE((SELECT jsonb_agg(jsonb_build_object('op', 'replace', 'path', v_path || _delta_build_path(f), 'value', v) ORDER BY f COLLATE "C")
                                      FROM jsonb_each(${after}) AS e(f, v) WHERE v IS DISTINCT FROM v_t->'was'->f), '[]'::jsonb);
    ELSIF v_is THEN
      v_told := v_told || jsonb_build_array(jsonb_build_object('op', CASE WHEN v_root THEN 'replace' ELSE 'add' END, 'path', v_path, 'value', ${after}));
    ELSIF v_root THEN   -- gone: ${doc.implied ? "the empty root it then opens with" : "null"}
      v_told := v_told || jsonb_build_array(jsonb_build_object('op', 'replace', 'path', v_path, 'value', ${gone}));
    ELSE
      v_told := v_told || jsonb_build_array(jsonb_build_object('op', 'remove', 'path', v_path));
    END IF;
  END LOOP;
  RETURN v_told;
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The SQL that answers what each of `docs` is told of a write: a function per document, and `_delta_told` sending each to its own. */
export function compileTold(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_told(p_def _delta_docs, p_target TEXT, p_rows JSONB)
RETURNS JSONB AS $$
BEGIN
  CASE p_def.prefix
${docs.map((d) => `    WHEN ${lit(d.prefix)} THEN RETURN ${toldFunction(d.prefix)}(p_target, p_rows);`).join("\n")}
    ELSE ${noDoc("p_target")}
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...docs.map((d) => toldOf(schema, d)), dispatch, ""].join("\n\n");
}
