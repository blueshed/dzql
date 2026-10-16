/**
 * The path language, delta's now (`@blueshed/delta/paths`), against a real model: every one of
 * modeling-dzql's 204 permission rules, its tables said once as delta's definitions, each rule
 * the `owns` of a document rooted at its table. Unpatched, the rules that pass through a column
 * the model's schema lacks are refused, naming it; completed (`patchedModelingDomain`), every one
 * can be followed, and lowers to SQL that reaches someone (never FALSE).
 */
import { describe, expect, test } from "bun:test";
import { defineSchema, type DocDef } from "@blueshed/delta/backend";
import { checkPath, parsePath, pathSql } from "@blueshed/delta/paths";
import * as fixture from "../fixtures/modeling-dzql.domain.js";
import { MISSING_COLUMNS, patchedModelingDomain } from "../fixtures/modeling-dzql.patched.js";

/** A dzql entity's schema as delta's definitions: each column by its type, nullable, no versions. */
function definitions(entities: Record<string, any>) {
  const typeOf = (sql: string) => {
    const t = sql.trim().split(/\s/)[0]!.toLowerCase();
    if (/^(int|integer|int2|int4|int8|smallint|bigint|serial|bigserial)$/.test(t)) return "integer";
    if (/^(numeric|real|float|float8|double)$/.test(t)) return "real";
    if (/^(bool|boolean)$/.test(t)) return "boolean";
    if (/^(timestamptz|timestamp|date)$/.test(t)) return "timestamptz";
    if (/^(json|jsonb)$/.test(t)) return "json";
    return "text";
  };
  return defineSchema(Object.fromEntries(Object.entries(entities).map(([table, e]) => [table, {
    columns: Object.fromEntries(Object.entries<string>(e.schema).filter(([c]) => c !== "id").map(([c, sql]) => [c, `${typeOf(sql)}?`])),
    temporal: false,
  }])) as any);
}

const rules = (entities: Record<string, any>) => Object.entries(entities).flatMap(([table, e]) =>
  Object.entries<string[]>(e.permissions ?? {}).flatMap(([action, list]) => list.map((owns) => ({ where: `${table}.permissions.${action}`, doc: { prefix: `${table}:`, root: table, include: [], scope: {}, owns } as DocDef & { owns: string } }))));

describe("modeling-dzql's rules as documents' owns", () => {
  const verbatim = rules(fixture.entities);

  test("there are 204, and every one parses", () => {
    expect(verbatim).toHaveLength(204);
    for (const { where, doc } of verbatim) expect(() => parsePath(doc.owns), where).not.toThrow();
  });

  test("against the model's own schema, each refusal names a column its rules assume and its schema lacks, and each such column is named", () => {
    const schema = definitions(fixture.entities);
    const problems = verbatim.flatMap(({ doc }) => checkPath(doc, schema));
    const known = MISSING_COLUMNS.filter(([, column]) => column !== "id")   // every collection has its id
      .map(([table, column]) => new RegExp(`^(${table} has no column ${column}|${table}\\.${column} is text, not an integer key)$`));
    for (const p of problems) expect(known.some((k) => k.test(p)), p).toBe(true);
    for (const k of known) expect(problems.some((p) => k.test(p)), String(k)).toBe(true);
  });

  test("with its schema completed, every rule can be followed, and lowers to SQL that reaches someone", () => {
    const patched = patchedModelingDomain().entities;
    const schema = definitions(patched);
    for (const { where, doc } of rules(patched)) {
      expect(checkPath(doc, schema), `${where}: ${doc.owns}`).toEqual([]);
      const sql = pathSql(parsePath(doc.owns), schema, { start: (f) => `r.${f}`, person: "p_person" });
      expect(sql, `${where}: ${doc.owns}`).not.toContain("FALSE");
      expect(sql).toContain("p_person");
    }
  });
});
