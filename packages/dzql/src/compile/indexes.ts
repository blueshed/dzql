/**
 * Indexes: each column the documents look a row up by, written from the definitions.
 *
 * `tableSql` indexes a table's parent key, and a temporal one's (id, valid_to). The rest of what a
 * write or an open asks by is here, a column at a time, `idx_<table>_<column>` on (column, id): the
 * name a parent key's index has, so a migration that renames the column renames it too, and the id
 * after it, so a lookup that wants the first row by id (`_delta_refs_hold`'s) reads one entry:
 * - a column that names a row of another collection (`refs`): the check that a row taken away is
 *   no longer named (`_delta_refs_hold`) asks the naming table by it;
 * - a column that takes a row with the one it names (`cascadeOn`): a remove's cascade asks by it;
 * - a column a document's scope reads its root rows by (an equality or a range; not `like`, which
 *   an index does not serve, nor `at`, a time);
 * - each column an `owns` path's hop filters by (`members[org_id=$]`): the path's check (the open,
 *   the write, the fan-out, the tables' row-level security) asks the hop's table by it.
 * An id is the table's key, and a column that already leads one of its indexes (its parent key, a
 * unique constraint's first) is left alone; so is a boolean (two values: an index rarely helps a
 * read and always costs a write) and a json column (a value can outgrow what an index entry holds).
 * `CREATE INDEX IF NOT EXISTS`: applied again, nothing changes; applied to a table that holds rows,
 * it builds the index then (a lock on the table while it does: on a large table, make it beforehand
 * with `CREATE INDEX CONCURRENTLY` under the same name).
 */
import { q, scopeEntries, type DocDef, type Schema } from "@blueshed/delta/backend";
import { parsePath } from "@blueshed/delta/paths";

/** Each [collection, column] the documents look rows up by, in order: by collection, then column. */
export function lookupColumns(schema: Schema, docs: DocDef[]): [string, string][] {
  const wanted = new Map<string, Set<string>>();
  const want = (coll: string, col: string) => {
    const type = schema.tables[coll]?.columns[col]?.type;
    if (col === "id" || !schema.tables[coll] || type === "boolean" || type === "json") return;
    (wanted.get(coll) ?? wanted.set(coll, new Set()).get(coll)!).add(col);
  };
  for (const [coll, t] of Object.entries(schema.tables)) {
    for (const ref of t.refs ?? []) want(coll, ref.column);
    for (const by of t.referencedBy) want(by.collection, by.fkColumn);
  }
  for (const d of docs) {
    for (const [key, binding] of scopeEntries(d.scope ?? {})) {
      if (/^(like|at):/.test(binding)) continue;
      want(d.root, key);
    }
    if (typeof d.owns !== "string") continue;
    const parsed = parsePath(d.owns);
    if ("literal" in parsed) continue;
    for (const hop of parsed.hops) for (const f of hop.filters) want(hop.table, f.field);
  }
  const led = (coll: string, col: string) => {
    const t = schema.tables[coll]!;
    return t.parent?.fkColumn === col || (t.unique ?? []).some((u) => u.columns[0] === col);
  };
  const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...wanted.keys()].sort(byKey).flatMap((coll) =>
    [...wanted.get(coll)!].sort(byKey).filter((col) => !led(coll, col)).map((col): [string, string] => [coll, col]));
}

/** The indexes the documents' lookups need, beside those `tableSql` makes. */
export function compileIndexes(schema: Schema, docs: DocDef[]): string {
  const lines = lookupColumns(schema, docs).map(([coll, col]) => {
    const table = schema.tables[coll]!.name;
    return `CREATE INDEX IF NOT EXISTS ${q(`idx_${table}_${col}`)} ON ${q(table)} (${q(col)}, id);`;
  });
  return lines.length ? `-- each column the documents look rows up by (refs, cascadeOn, a scope, an owns path)\n${lines.join("\n")}\n` : "";
}
