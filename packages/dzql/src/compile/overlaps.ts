/**
 * No two current rows overlap (delta's `noOverlap`): held at the end of a write, and by the database
 * itself, written from the schema.
 *
 * `compileOverlaps(schema)` writes:
 * - `_delta_overlaps_hold(touched)`, which `delta_apply` asks once its ops are applied (a walk's too),
 *   after `_delta_refs_hold`, of the rows the write changed, each by its first touch, as delta's
 *   `overlapsHold` asks them: for each noOverlap of a row there now, its range ends before it starts
 *   (22023, 400), or, under an advisory lock on the constraint and the row's `same` values (so two
 *   writes at once take turns), no other current row of those values holds a range overlapping it,
 *   else `Overlaps: <coll>/<id> and <coll>/<id>, of the same <same>, both hold <start> to <end> at once
 *   -- move or remove one first` (23P01, an exclusion: 409), the first such row by id. In delta's
 *   words. It reads as the functions' owner (SECURITY DEFINER), so a row the writer may not read
 *   still holds its time.
 * - for each table, its noOverlap as an `EXCLUDE USING gist` constraint (`excl_<table>_<start>_<end>`),
 *   on its current rows, `DEFERRABLE INITIALLY DEFERRED` (a write is judged as it leaves the rows, as
 *   delta judges it): the database's own, for SQL that writes past `delta_apply`. Equal `same`
 *   columns need `btree_gist` (made here where it can be: PGlite has it, as a server's contrib does);
 *   where it cannot, the constraint is not made, and the write path's check holds alone. Rows that
 *   already overlap refuse it (23P01): the SQL is not applied until they are moved. One the
 *   definitions no longer say is dropped.
 */
import { q, type ResolvedNoOverlap, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { caseOf, lit, standingRows } from "./opens";
import { searchPath } from "./lookups";

/** The constraint's name as Postgres keeps it: delta's, ended by a hash where it would pass 63 bytes. */
export function exclusionName(n: ResolvedNoOverlap): string {
  if (Buffer.byteLength(n.name) <= 63) return n.name;
  let h = 0x811c9dc5;
  for (const ch of n.name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${n.name.slice(0, 54)}_${h.toString(16).padStart(8, "0")}`;
}

/** The range a row of `alias` (none: the table's own, in its constraint) holds: empty where it ends before it starts (refused by the write path, never a 500 here). */
function rangeSql(n: ResolvedNoOverlap, alias?: string): string {
  const [s, e] = n.range.map((c) => (alias ? `${alias}.${q(c)}` : q(c)));
  const [kind, cast] = n.type === "timestamptz" ? ["tstzrange", ""] : n.type === "date" ? ["daterange", ""] : ["numrange", "::numeric"];
  return `(CASE WHEN ${s} IS NOT NULL AND ${e} IS NOT NULL AND ${s} > ${e} THEN 'empty'::${kind} ELSE ${kind}(${s}${cast}, ${e}${cast}, '${n.bounds}') END)`;
}

/** delta's words for two rows a noOverlap holds apart (its `overlapSentence`), as a RAISE's format and arguments. */
function clashRaise(coll: string, n: ResolvedNoOverlap): string {
  const same = n.same.length ? `, of the same ${n.same.join(" and ")},` : "";
  return `RAISE EXCEPTION 'Overlaps: %/% and %/%${same.replace(/'/g, "''")} both hold % to % at once -- move or remove one first', ${lit(coll)}, v_t.id, ${lit(coll)}, v_by, ${lit(n.range[0])}, ${lit(n.range[1])} USING ERRCODE = '23P01';`;
}

/** One table's noOverlap checks, for `_delta_overlaps_hold`. */
function holdOf(coll: string, t: ResolvedTable): string {
  const rows = standingRows(t);
  return (t.noOverlap ?? []).map((n) => {
    const [s, e] = n.range.map(q);
    const same = n.same.map((c) => ` AND o.${q(c)} = r.${q(c)}`).join("");
    const key = n.same.length ? `concat_ws(',', ${n.same.map((c) => `r.${q(c)}::text`).join(", ")})` : "''";
    return `        IF EXISTS (SELECT 1 FROM ${rows} r WHERE r.id = v_t.id AND r.${s} IS NOT NULL AND r.${e} IS NOT NULL AND r.${s} > r.${e}) THEN
          RAISE EXCEPTION '%/%: its % is before its % (noOverlap holds a range from % to %)', ${lit(coll)}, v_t.id, ${lit(n.range[1])}, ${lit(n.range[0])}, ${lit(n.range[0])}, ${lit(n.range[1])} USING ERRCODE = '22023';
        END IF;
        SELECT ${key} INTO v_key FROM ${rows} r WHERE r.id = v_t.id;
        IF FOUND THEN
          PERFORM pg_advisory_xact_lock(hashtext(${lit(`delta-overlap:${n.name}`)}), hashtext(COALESCE(v_key, '')));
          SELECT o.id INTO v_by FROM ${rows} r, ${rows} o
           WHERE r.id = v_t.id AND o.id <> r.id${same} AND ${rangeSql(n, "o")} && ${rangeSql(n, "r")}
           ORDER BY o.id LIMIT 1;
          IF v_by IS NOT NULL THEN
            ${clashRaise(coll, n)}
          END IF;
        END IF;`;
  }).join("\n");
}

/** Each table's exclusion constraints, made where they can be, and dzql's it no longer says, dropped. */
function exclusionsOf(schema: Schema): string {
  const tables = Object.values(schema.tables);
  const any = tables.some((t) => t.noOverlap?.some((n) => n.same.length));
  const blocks = tables.map((t) => {
    const said = (t.noOverlap ?? []).map(exclusionName);
    const rel = `to_regclass(${lit(q(t.name))})`;
    const drop = `  FOR v_c IN SELECT conname FROM pg_constraint WHERE conrelid = ${rel} AND contype = 'x' AND conname LIKE 'excl\\_%'${said.length ? ` AND conname NOT IN (${said.map(lit).join(", ")})` : ""} LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', ${lit(t.name)}, v_c);
  END LOOP;`;
    const add = (t.noOverlap ?? []).map((n) => {
      const parts = [...n.same.map((c) => `${q(c)} WITH =`), `${rangeSql(n)} WITH &&`];
      return `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ${rel} AND conname = ${lit(exclusionName(n))}) THEN
    BEGIN
      ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(exclusionName(n))} EXCLUDE USING gist (${parts.join(", ")})${t.temporal ? " WHERE (valid_to IS NULL)" : ""} DEFERRABLE INITIALLY DEFERRED;
    EXCEPTION WHEN undefined_object THEN
      RAISE NOTICE '%: no btree_gist here, so the write path alone holds it', ${lit(exclusionName(n))};
    END;
  END IF;`;
    });
    return [drop, ...add].join("\n");
  });
  return `DO $$
DECLARE
  v_c TEXT;
BEGIN${any ? `
  -- equal columns in a gist index are btree_gist's: made where it may be (PGlite and a server's contrib have it)
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;` : ""}
${blocks.join("\n") || "  NULL;"}
END $$;`;
}

/** `_delta_overlaps_hold` for every collection of `schema` with a noOverlap, and their exclusion constraints. */
export function compileOverlaps(schema: Schema): string {
  const branches = Object.entries(schema.tables).flatMap(([coll, t]) => (t.noOverlap ? [`      WHEN ${lit(coll)} THEN\n${holdOf(coll, t)}`] : []));
  const body = branches.length
    ? `  FOR v_t IN
    SELECT t->>'coll' AS coll, (t->>'id')::bigint AS id
      FROM jsonb_array_elements(COALESCE(p_touched, '[]'::jsonb)) WITH ORDINALITY AS e(t, n)
     WHERE NOT COALESCE((t->>'carried')::boolean, FALSE)
     GROUP BY 1, 2 ORDER BY min(n)
  LOOP
${caseOf("v_t.coll", branches, "NULL;   -- a collection with no noOverlap", { indent: "    " })}
  END LOOP;`
    : "  NULL;   -- no collection holds its ranges apart";
  return `${exclusionsOf(schema)}

CREATE OR REPLACE FUNCTION _delta_overlaps_hold(p_touched JSONB)
RETURNS void AS $$
DECLARE
  v_t   RECORD;
  v_key TEXT;
  v_by  BIGINT;
BEGIN
${body}
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
${searchPath("_delta_overlaps_hold(jsonb)")}
`;
}
