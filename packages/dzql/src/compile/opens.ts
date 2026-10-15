/**
 * Compiled opens: delta's documents, read by SQL written for each one.
 *
 * `compileOpens(schema, docs)` turns an app's `defineSchema` / `defineDoc`
 * into the reads of each document -- `dzql_open__<slug>(name)` and
 * `dzql_open_at__<slug>(name, at)`, each with an `_as` for a signed-in caller --
 * which the listener opens that document's names through (`docTypeFromDef`). Each answers what `delta_open`
 * answers (the listener then shows it by the same schema), but its queries
 * are written out: which
 * table, which columns, how a collection hangs from the root, whether a row
 * is temporal, what an implied root opens with. Nothing reads
 * `_delta_collections` to find them.
 *
 * Still the framework's, until compiled in turn (plan step 2c): reading a
 * name's scope (`_delta_resolve_scope`, which answers the root's condition as
 * SQL text, so the root's query is run with EXECUTE) and the document's
 * version (`_delta_versions`).
 *
 * A pure function: the same definitions give the same text, byte for byte.
 * A definition it cannot compile is an error naming the document, never SQL
 * that half works.
 */
import { q, type ColumnDef, type DocDef, type ResolvedTable, type Schema } from "@blueshed/delta/backend";

/** A string as an SQL literal. */
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** A document's function name: its prefix, lower case, every other character `_`. */
export function openFunction(prefix: string): string {
  return `dzql_open__${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/** The columns a document shows of a collection's row: its id, its parent key, and its declared columns or, where it names them, those. */
function shown(table: ResolvedTable, doc: DocDef, coll: string): string[] {
  const held = doc.columns?.[coll];
  const cols = Object.keys(table.columns).filter((c) => !held || held.includes(c));
  return ["id", ...(table.parent ? [table.parent.fkColumn] : []), ...cols];
}

/** A row as a JSON object of the columns shown. */
const rowJson = (alias: string, cols: string[]): string =>
  `jsonb_build_object(${cols.map((c) => `${lit(c)}, ${alias}.${q(c)}`).join(", ")})`;

/** The rows of a temporal table that stand now, or at `at` (a time in the name): ` AND <condition>`; nothing for a table that is not temporal. */
const standing = (table: ResolvedTable, alias: string, at = "p_at"): string =>
  table.temporal
    ? ` AND (CASE WHEN ${at} IS NULL THEN ${alias}.valid_to IS NULL ELSE ${alias}.valid_from <= ${at} AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > ${at}) END)`
    : "";

/** An implied document's root before its row is there: its id and each column's default, as `_delta_implied_root` gives it. */
function impliedRoot(table: ResolvedTable, doc: DocDef): string {
  const held = doc.columns?.[doc.root];
  const value = (d: ColumnDef): unknown =>
    d.default !== undefined && d.default !== null ? d.default
    : d.nullable ? null
    : d.type === "text" ? ""
    : d.type === "integer" || d.type === "real" ? 0
    : d.type === "boolean" ? false
    : null;
  const fields = Object.entries(table.columns).filter(([c]) => !held || held.includes(c)).map(([c, d]) => [c, value(d)]);
  return `jsonb_build_object('id', v_id) || ${lit(JSON.stringify(Object.fromEntries(fields)))}::jsonb`;
}

/**
 * A collection a single document includes, held under its root row `v_id`:
 * its rows joined up their parent chain to the root. A collection with no
 * parent is held whole; one whose chain ends short of the root holds nothing.
 */
function includedSingle(schema: Schema, doc: DocDef, coll: string): string {
  const table = need(schema, doc, coll);
  const cols = shown(table, doc, coll);
  if (!table.parent) return includedList(schema, doc, coll);
  const joins: string[] = [];
  let where = "";
  let child = table;
  let alias = "t";
  for (let hop = 1; ; hop++) {
    const parentKey = child.parent!.collection;
    if (parentKey === doc.root) {
      where = `${alias}.${q(child.parent!.fkColumn)} = v_id${standing(table, "t")}`;
      break;
    }
    const parent = need(schema, doc, parentKey);
    if (!parent.parent) return `'{}'::jsonb`;   // the chain ends short of the root: nothing of it is in the document
    const p = `p${hop}`;
    joins.push(`JOIN ${q(parent.name)} ${p} ON ${p}.id = ${alias}.${q(child.parent!.fkColumn)}${standing(parent, p)}`);
    child = parent;
    alias = p;
  }
  return `(SELECT COALESCE(jsonb_object_agg(t.id, ${rowJson("t", cols)}), '{}'::jsonb) FROM ${[`${q(table.name)} t`, ...joins].join(" ")} WHERE ${where})`;
}

/** A collection a list document includes: every row of it, as `_delta_load_collection_all` reads it. */
function includedList(schema: Schema, doc: DocDef, coll: string): string {
  const table = need(schema, doc, coll);
  return `(SELECT COALESCE(jsonb_object_agg(t.id, ${rowJson("t", shown(table, doc, coll))}), '{}'::jsonb) FROM ${q(table.name)} t${standing(table, "t").replace(" AND", " WHERE")})`;
}

function need(schema: Schema, doc: DocDef, coll: string): ResolvedTable {
  const table = schema.tables[coll];
  if (!table) throw new Error(`[dzql compile] document ${doc.prefix} names a collection the schema does not have: ${coll}`);
  return table;
}

/** A document's function for `open_at`: the document as it stood at a time the caller gives. */
export const openAtFunction = (prefix: string): string => openFunction(prefix).replace(/^dzql_open__/, "dzql_open_at__");

/**
 * One document's read, as `open` (`delta_open`: the time is the name's, an implied
 * root opens with its defaults, the version is kept) or as `open_at`
 * (`delta_open_at`: the time is the caller's, a root not there is null, no version).
 */
function readOf(schema: Schema, doc: DocDef, at: boolean): string {
  const root = need(schema, doc, doc.root);
  const rootJson = rowJson("t", shown(root, doc, doc.root));
  const fields = (included: (coll: string) => string) =>
    doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, ${included(c)})`).join("");
  const emptyIncludes = doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, '{}'::jsonb)`).join("");
  const fn = at ? openAtFunction(doc.prefix) : openFunction(doc.prefix);
  const params = at ? "p_name TEXT, p_given TIMESTAMPTZ" : "p_name TEXT";
  const missing = !at && doc.implied ? `v_doc := jsonb_build_object(${lit(doc.root)}, ${impliedRoot(root, doc)})${emptyIncludes};` : "RETURN NULL;";
  const done = at
    ? "RETURN v_doc;"
    : `INSERT INTO _delta_versions (doc_name, version) VALUES (p_name, 0) ON CONFLICT (doc_name) DO NOTHING;
  SELECT version INTO v_version FROM _delta_versions WHERE doc_name = p_name;
  RETURN v_doc || jsonb_build_object('_version', v_version);`;
  return `CREATE OR REPLACE FUNCTION ${fn}(${params})
RETURNS JSONB AS $$
DECLARE
  v_scope  JSONB;
  v_where  TEXT;
  p_at     TIMESTAMPTZ;
  v_id     BIGINT;
  v_rows   JSONB;
  v_root   JSONB;
  v_doc    JSONB;
  v_version BIGINT;
BEGIN
  v_scope := _delta_resolve_scope((SELECT d FROM _delta_docs d WHERE d.prefix = ${lit(doc.prefix)}), p_name);
  v_where := v_scope->>'where';
  p_at := ${at ? "p_given" : "(v_scope->>'at')::TIMESTAMPTZ"};
  IF v_scope->>'mode' = 'list' THEN
    EXECUTE format('SELECT COALESCE(jsonb_object_agg(t.id, ${rootJson.replace(/%/g, "%%").replace(/'/g, "''")}), ''{}''::jsonb) FROM ${q(root.name)} t WHERE %s${standing(root, "t", "$1").replace(/'/g, "''")}', v_where)
      INTO v_rows USING p_at;
    v_doc := jsonb_build_object(${lit(doc.root)}, v_rows)${fields((c) => includedList(schema, doc, c))};
  ELSE
    v_id := (v_scope->'values'->>'id')::BIGINT;
    EXECUTE format('SELECT ${rootJson.replace(/%/g, "%%").replace(/'/g, "''")} FROM ${q(root.name)} t WHERE t.id = $1 AND %s${standing(root, "t", "$2").replace(/'/g, "''")}', v_where)
      INTO v_root USING v_id, p_at;
    IF v_root IS NULL THEN
      ${missing}
    ELSE
      v_doc := jsonb_build_object(${lit(doc.root)}, v_root)${fields((c) => includedSingle(schema, doc, c))};
    END IF;
  END IF;
  ${done}
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ${fn}_as(p_user_id TEXT, ${params})
RETURNS JSONB AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id, true);
  RETURN ${fn}(${at ? "p_name, p_given" : "p_name"});
END
$$ LANGUAGE plpgsql;`;
}

/** One document's reads: its open and its open_at, each with its `_as`. */
function openOf(schema: Schema, doc: DocDef): string {
  return `-- ${doc.prefix}: root ${doc.root}${doc.include.length ? `, includes ${doc.include.join(", ")}` : ""}${doc.implied ? ", implied" : ""}${doc.columns ? `, holds ${Object.entries(doc.columns).map(([c, cs]) => `${c}(${cs.join(", ")})`).join(" ")}` : ""}
${readOf(schema, doc, false)}

${readOf(schema, doc, true)}`;
}

/** The SQL that reads each of `docs` over `schema`: its open and its open_at, each with an `_as` for a signed-in caller. */
export function compileOpens(schema: Schema, docs: DocDef[]): string {
  const names = new Map<string, string>();
  for (const doc of docs) {
    const fn = openFunction(doc.prefix);
    const other = names.get(fn);
    if (other !== undefined) throw new Error(`[dzql compile] documents ${other} and ${doc.prefix} would share the function ${fn}`);
    names.set(fn, doc.prefix);
  }
  return [
    "-- Compiled by dzql from the app's defineSchema / defineDoc. Do not edit: compile again.",
    ...docs.map((d) => openOf(schema, d)),
    "",
  ].join("\n\n");
}
