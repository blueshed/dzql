/**
 * Compiled scope resolution: a document's name read as its definition's scope
 * reads it. Asked by every write (`delta_apply`: its mode, its root's id, the
 * values an add to a list is given, the conditions its root must meet), by
 * the framework's reads and by the ops log -- `_delta_resolve_scope`.
 *
 * `compileResolve(schema, docs)` writes `dzql_scope__<slug>(name, refuse)` for
 * each document, giving the framework's answer exactly, as JSON: `where` (the
 * conditions as SQL text, in the framework's words), `values` (the equality
 * bindings), `mode` and `at`; a value its column cannot take refused with the
 * same message (`scopeOf`), raised, or with `refuse` false answered as the
 * scope that holds nothing. And `_delta_resolve_scope` itself, which sends each
 * compiled document to its own and any other to the framework
 * (`_delta_resolve_scope_framework`).
 */
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { lit, need, openFunction, scopeOf } from "./opens";

/** A document's scope function: `dzql_scope__<slug>`. */
export const resolveFunction = (prefix: string): string => openFunction(prefix).replace(/^dzql_open__/, "dzql_scope__");

/** Refused: raised (22P02), or with `p_refuse` false, the scope that holds nothing, naming why. */
const refuse = (message: string, value: string): string => {
  const m = message.replace(/'/g, "''");
  return `IF p_refuse THEN RAISE EXCEPTION '${m}', ${value} USING ERRCODE = '22P02'; END IF;
      RETURN jsonb_build_object('where', 'FALSE', 'values', '{}'::jsonb, 'mode', 'list', 'at', NULL, 'refused', format('${m.replace(/%/g, "%s")}', ${value}));`;
};

/** One document's scope function. */
function resolveOf(schema: Schema, doc: DocDef): string {
  need(schema, doc, doc.root);
  const head = `CREATE OR REPLACE FUNCTION ${resolveFunction(doc.prefix)}(p_name TEXT, p_refuse BOOLEAN)
RETURNS JSONB AS $$`;
  if (Object.keys(doc.scope ?? {}).length === 0) {
    // no scope: a name with nothing after its prefix is the list; else the one row its id names
    return `${head}
DECLARE
  v_rest TEXT := substring(p_name FROM ${doc.prefix.length + 1});
BEGIN
  IF v_rest = '' THEN
    RETURN jsonb_build_object('where', 'TRUE', 'values', '{}'::jsonb, 'mode', 'list', 'at', NULL);
  END IF;
  RETURN jsonb_build_object('where', format('id = %L', v_rest), 'values', jsonb_build_object('id', v_rest::BIGINT), 'mode', 'single', 'at', NULL);
END;
$$ LANGUAGE plpgsql STABLE;`;
  }
  const scope = scopeOf(schema, doc, refuse);
  return `${head}
DECLARE
  v_where  TEXT := '';
  v_values JSONB := '{}'::jsonb;
  v_at     TEXT;
  ${scope.declare.join("\n  ")}
BEGIN
  ${scope.checks}
  ${scope.resolve}
  IF v_where = '' THEN v_where := 'TRUE'; END IF;
  RETURN jsonb_build_object('where', v_where, 'values', v_values, 'mode', CASE WHEN v_values ? 'id' THEN 'single' ELSE 'list' END, 'at', v_at);
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** The SQL that resolves each of `docs`' names: a function per document, and `_delta_resolve_scope` sending each to its own. */
export function compileResolve(schema: Schema, docs: DocDef[]): string {
  const dispatch = `CREATE OR REPLACE FUNCTION _delta_resolve_scope(p_def _delta_docs, p_doc_name TEXT, p_refuse BOOLEAN)
RETURNS JSONB AS $$
BEGIN
  CASE p_def.prefix
${docs.map((d) => `    WHEN ${lit(d.prefix)} THEN RETURN ${resolveFunction(d.prefix)}(p_doc_name, p_refuse);`).join("\n")}
    ELSE RETURN _delta_resolve_scope_framework(p_def, p_doc_name, p_refuse);
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;`;
  return [...docs.map((d) => resolveOf(schema, d)), dispatch, ""].join("\n\n");
}
