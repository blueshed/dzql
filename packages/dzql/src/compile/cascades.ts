/**
 * Compiled cascades: what a remove takes with it, and what a moved row
 * carries. The framework walks `_delta_collections` at run time for a
 * collection's children and the collections that cascade on it, and builds
 * each query from their names; here the schema says them, and each is written.
 *
 * `compileCascades(schema)` writes, for every collection of the schema:
 * - `dzql_cascade_remove__<slug>(id)`: the row closed (temporal) or deleted, and
 *   only if it was there, each child collection's rows under it, then each
 *   collection that cascades on it -- the removes, in that order;
 * - `dzql_cascade_rows__<slug>(id)`: the rows that remove would take, read
 *   before, in the order it takes them;
 * - `dzql_hanging_rows__<slug>(id)`: the rows that hang from it, and on down,
 *   parent first.
 * And `_delta_cascade_remove`, `_delta_cascade_rows` and `_delta_hanging_rows`,
 * sending each collection to its own and any other to the framework's
 * (`_framework`). The order is the framework's: child collections by key, then
 * the collections that cascade on it by key and key column, each in the
 * database's byte order (`COLLATE "C"`), and each one's rows by id.
 */
import { q, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { lit } from "./opens";

/** A collection's function: `dzql_<what>__<slug>`. */
const fn = (what: string, coll: string): string => `dzql_${what}__${coll.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;

/** As `COLLATE "C"` orders text: by its bytes. */
const bytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** A table's rows as they stand: its current view, where temporal. */
const standing = (t: ResolvedTable): string => q(t.temporal ? `current_${t.name}` : t.name);

/** A collection's children, and the collections that cascade on it, in the framework's order: [collection, key column]. */
function reached(schema: Schema, coll: string): { children: [string, string][]; refs: [string, string][] } {
  const table = schema.tables[coll]!;
  const children = [...table.children].sort(bytes).map((c): [string, string] => [c, schema.tables[c]!.parent!.fkColumn]);
  const refs = table.referencedBy
    .filter((r) => r.collection !== coll)   // as generateSql's cascade_on: never a collection's own
    .map((r): [string, string] => [r.collection, r.fkColumn])
    .sort((a, b) => bytes(a[0], b[0]) || bytes(a[1], b[1]));
  return { children, refs };
}

/** Every collection of `schema` its own slug: two that would share a function name are refused. */
function assertSlugs(schema: Schema): void {
  const seen = new Map<string, string>();
  for (const coll of Object.keys(schema.tables)) {
    const slug = fn("", coll);
    const other = seen.get(slug);
    if (other) throw new Error(`[dzql compile] collections "${other}" and "${coll}" would share the function name ${slug}: rename one`);
    seen.set(slug, coll);
  }
}

function removeOf(schema: Schema, coll: string): string {
  const t = schema.tables[coll]!;
  const { children, refs } = reached(schema, coll);
  const walk = [...children, ...refs].map(([c, fk]) =>
    `  FOR v_id IN SELECT id FROM ${standing(schema.tables[c]!)} WHERE ${q(fk)} = p_id ORDER BY id LOOP
    v_ops := v_ops || ${fn("cascade_remove", c)}(v_id);
  END LOOP;`);
  return `CREATE OR REPLACE FUNCTION ${fn("cascade_remove", coll)}(p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_affected BIGINT;
  v_id       BIGINT;
  v_ops      JSONB;
BEGIN
  ${t.temporal ? `UPDATE ${q(t.name)} SET valid_to = NOW() WHERE id = p_id AND valid_to IS NULL;` : `DELETE FROM ${q(t.name)} WHERE id = p_id;`}
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 0 THEN RETURN '[]'::jsonb; END IF;   -- only a removal that happened (closed already, or RLS filtered it)
  v_ops := jsonb_build_array(jsonb_build_object('op', 'remove', 'path', _delta_build_path(${lit(coll)}, p_id::text)));
${walk.join("\n")}
  RETURN v_ops;
END;
$$ LANGUAGE plpgsql;`;
}

function rowsOf(schema: Schema, coll: string): string {
  const t = schema.tables[coll]!;
  const { children, refs } = reached(schema, coll);
  const walk = [...children, ...refs].map(([c, fk]) =>
    `  FOR v_id IN SELECT id FROM ${standing(schema.tables[c]!)} WHERE ${q(fk)} = p_id ORDER BY id LOOP
    v_rows := v_rows || ${fn("cascade_rows", c)}(v_id);
  END LOOP;`);
  return `CREATE OR REPLACE FUNCTION ${fn("cascade_rows", coll)}(p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_row  JSONB;
  v_id   BIGINT;
  v_rows JSONB;
BEGIN
  SELECT to_jsonb(t.*) INTO v_row FROM ${standing(t)} t WHERE t.id = p_id;
  IF v_row IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_rows := jsonb_build_array(jsonb_build_object('coll', ${lit(coll)}, 'id', p_id, 'row', _delta_strip_temporal(v_row)));
${walk.join("\n")}
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql STABLE;`;
}

function hangingOf(schema: Schema, coll: string): string {
  const { children } = reached(schema, coll);
  const parts = children.map(([c, fk]) => {
    const below = schema.tables[c]!.children.length ? `${fn("hanging_rows", c)}(t.id)` : "'[]'::jsonb";
    return `  SELECT COALESCE(jsonb_agg(e ORDER BY t.id, n), '[]'::jsonb) INTO v_part FROM ${standing(schema.tables[c]!)} t,
         jsonb_array_elements(jsonb_build_array(jsonb_build_object('coll', ${lit(c)}, 'id', t.id, 'row', _delta_strip_temporal(to_jsonb(t.*)))) || ${below})
           WITH ORDINALITY AS x(e, n)
   WHERE t.${q(fk)} = p_id;
  v_rows := v_rows || v_part;`;
  });
  return `CREATE OR REPLACE FUNCTION ${fn("hanging_rows", coll)}(p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_part JSONB;
  v_rows JSONB := '[]'::jsonb;
BEGIN
${parts.join("\n")}
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql STABLE;`;
}

/** A dispatcher: each collection of `schema` to its own, any other to the framework's. */
function dispatch(schema: Schema, name: string, what: string, volatility: string): string {
  const colls = Object.keys(schema.tables);
  const body = colls.length
    ? `  CASE p_collection_key
${colls.map((c) => `    WHEN ${lit(c)} THEN RETURN ${fn(what, c)}(p_id);`).join("\n")}
    ELSE RETURN ${name}_framework(p_collection_key, p_id);
  END CASE;`
    : `  RETURN ${name}_framework(p_collection_key, p_id);`;
  return `CREATE OR REPLACE FUNCTION ${name}(p_collection_key TEXT, p_id BIGINT)
RETURNS JSONB AS $$
BEGIN
${body}
END;
$$ LANGUAGE plpgsql${volatility};`;
}

/** The cascades and hanging rows of every collection of `schema`, and the dispatch to the framework's for any other. */
export function compileCascades(schema: Schema): string {
  assertSlugs(schema);
  const colls = Object.keys(schema.tables);
  return [
    ...colls.map((c) => removeOf(schema, c)),
    ...colls.map((c) => rowsOf(schema, c)),
    ...colls.map((c) => hangingOf(schema, c)),
    dispatch(schema, "_delta_cascade_remove", "cascade_remove", ""),
    dispatch(schema, "_delta_cascade_rows", "cascade_rows", " STABLE"),
    dispatch(schema, "_delta_hanging_rows", "hanging_rows", " STABLE"),
    "",
  ].join("\n\n");
}
