/**
 * Row-level security from the documents' paths (todo #19): the backstop beneath the compiled reads
 * and writes, which run as the invoker. A compiler bug in one of them (a scope, a hold, an open that
 * reads too much) then meets the table's policy, compiled independently from the same `owns` path by
 * delta's `pathSql`, and a person reads or writes only a row some document they may have holds.
 *
 * `compilePolicies(schema, docs)` writes, for each table every document holding it says by a path
 * (`owns` as a string), `dzql_may__<collection>(row, check)`: may the person (`app.user_id`) have a
 * document that holds this row? -- a document's path from the row's own values where it is the
 * root, else from the root row it hangs from (its chain of parents), else from any root row; and
 * `_delta_govern` (001b) puts it on the table, enabled and forced, as the policy `dzql_owns`. A
 * table some document holds with no path (none, a function, `shared`) says nothing a policy can, and
 * is left to the app; a policy dzql made on it before is taken off.
 *
 * `dzql_may__` reads past row-level security (it is SECURITY DEFINER, and raises `dzql.definer`,
 * which the policy lets past for the table's owner alone): a path follows other documents' rows
 * (memberships), which the person's own policies would hide, or loop back to. It answers yes or no,
 * never a row.
 */
import { q, type DocDef, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { parsePath, pathSql } from "@blueshed/delta/paths";
import { chainRoot } from "./holds";
import { searchPath } from "./lookups";
import { lit, named, need, currentOnly, WHOLE } from "./opens";

/** A collection's policy function: `dzql_may__<slug>`. */
export const mayFunction = (coll: string): string => named("may", coll);

/**
 * What a definer function says as it reads past row-level security, and after: `dzql.definer` is
 * raised for its own reads, and put back as it was before it returns, so the caller's next query
 * meets the policies again. Each policy lets it past for the table's owner (`_delta_govern`), so a
 * function owned by the role that applied the SQL sees every row, and one that role did not write
 * gains nothing by it. An error on the way ends the transaction, and the setting with it.
 */
export const PAST = {
  declare: "v_was_past TEXT := current_setting('dzql.definer', true);",
  raise: "PERFORM set_config('dzql.definer', 'on', true);",
  lower: "PERFORM set_config('dzql.definer', COALESCE(v_was_past, ''), true);",
};

type Pathed = DocDef & { owns: string };

/** An integer as a name's value is one (a scoped document's start, as `dzql_owns__` reads it). */
const asName = (value: string): string => `(CASE WHEN (${value})::text ~ '${WHOLE}' THEN (${value})::text::BIGINT END)`;

/** Does `doc`'s path reach the person from a row of `coll` (`p_row`)? `check`: as a row is written (its own values alone). */
function reach(schema: Schema, doc: Pathed, coll: string): string {
  const parsed = parsePath(doc.owns);
  const root = need(schema, doc, doc.root);
  const scoped = Object.keys(doc.scope ?? {}).length > 0;
  const path = (start: (field: string) => string) => `COALESCE(${pathSql(parsed, schema, { start, person: "v_person" })}, FALSE)`;
  // a root row's column, by its id: the current version of a row that keeps versions
  const column = (id: string, field: string, alias = "r") =>
    `(SELECT ${alias}.${q(field)} FROM ${q(root.name)} ${alias} WHERE ${alias}.id = ${id}${currentOnly(root, alias)})`;
  const fromRoot = (id: string) => (field: string) =>
    scoped ? asName(column(id, field)) : field === "id" ? id : column(id, field);

  if (coll === doc.root) {
    const own = path((field) => (scoped ? asName(`(p_row).${q(field)}`) : `(p_row).${q(field)}`));
    // a past version of a single document's root is the document's while its current row reaches the person
    return root.temporal && !scoped ? `(${own} OR (NOT p_check AND ${path(fromRoot("(p_row).id"))}))` : own;
  }
  const table = need(schema, doc, coll);
  const id = table.parent ? chainRoot(schema, doc, coll, (fk) => `(p_row).${q(fk)}`) : "NULL::BIGINT";
  if (id !== "NULL::BIGINT") return path(fromRoot(id));
  // a collection that hangs from no root row is held whole by each of the document's names: the
  // person has it where the path reaches them from some root row, or, starting at a table, at all
  let started = false;
  pathSql(parsed, schema, { start: () => { started = true; return "NULL"; }, person: "v_person" });
  if (!started) return path(() => "NULL");
  return `EXISTS (SELECT 1 FROM ${q(root.name)} t WHERE TRUE${currentOnly(root, "t")} AND ${path((field) => (scoped ? asName(`t.${q(field)}`) : `t.${q(field)}`))})`;
}

/** One collection's policy function, over the documents that hold it. */
function mayOf(schema: Schema, coll: string, table: ResolvedTable, holding: Pathed[]): string {
  return `CREATE OR REPLACE FUNCTION ${mayFunction(coll)}(p_row ${q(table.name)}, p_check BOOLEAN)
RETURNS BOOLEAN AS $$
DECLARE
  v_user   TEXT := current_setting('app.user_id', true);
  v_person BIGINT := CASE WHEN v_user ~ '${WHOLE}' THEN v_user::BIGINT END;
  v_may    BOOLEAN;
  ${PAST.declare}
BEGIN
  ${PAST.raise}
  v_may := ${holding.map((d) => `-- ${d.prefix}\n    ${reach(schema, d, coll)}`).join("\n    OR ")};
  ${PAST.lower}
  RETURN v_may;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
${searchPath(`${mayFunction(coll)}(${q(table.name)}, boolean)`)}`;
}

/** Each table's row-level security: a policy where every document holding it says a path, and none elsewhere. */
export function compilePolicies(schema: Schema, docs: DocDef[]): string {
  return Object.entries(schema.tables).map(([coll, table]) => {
    const holding = docs.filter((d) => d.root === coll || d.include.includes(coll));
    if (holding.length === 0 || !holding.every((d): d is Pathed => d.owns !== undefined)) return `SELECT _delta_govern(${lit(table.name)}, NULL);`;
    return `${mayOf(schema, coll, table, holding)}\nSELECT _delta_govern(${lit(table.name)}, ${lit(mayFunction(coll))});`;
  }).join("\n\n") + "\n";
}
