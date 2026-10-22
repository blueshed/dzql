/**
 * Row SQL: the statements a write runs on a row, written for each collection, so each is a statement
 * whose plan the database keeps.
 *
 * `compileRows(schema)` writes, for every collection of the schema:
 * - `_delta_row_lock`: the row as it stands (a temporal one's open version), locked for the write;
 * - `_delta_row_put`: a replace's row stored -- a temporal one a new version (one this write made
 *   gives way to it, the standing one closes), else the row updated in place -- answered as stored;
 * - `_delta_next_id`: an add's id, from the collection's sequence;
 * - `_delta_row_clear_moment`: a temporal version this write made and took back, so an add of its id
 *   takes its place;
 * - `_delta_row_there`: is the row there now (a temporal one's open version)?
 * - `_delta_row_read`: the row as it stands, without its validity;
 * - `_delta_row_add`: an add's row stored. An INSERT names the columns the row gives
 *   (`_delta_insert_sql`), so one it leaves out takes its database default: where the row gives
 *   exactly every column the schema declares (its id, parent key, columns and validity), that INSERT
 *   is one statement, written here; a row with any other keys is stored by the columns it gives
 *   (`_delta_row_add_given`).
 *
 * A collection none was compiled for is refused (`unknown collection`), and a row of it is not there.
 */
import { q, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { lit, noCollection, rowJson, rowTexts, standingRows, caseOf } from "./opens";
import { seqOf } from "../postgres/sql";

/** A CASE over the collections, each branch from `branch`, any other collection to `fallback`. */
function dispatch(schema: Schema, branch: (coll: string, table: Schema["tables"][string]) => string | null, fallback: string): string {
  const branches = Object.entries(schema.tables).flatMap(([coll, table]) => {
    const b = branch(coll, table);
    return b === null ? [] : [`    WHEN ${lit(coll)} THEN\n      ${b}`];
  });
  return caseOf("p_coll", branches, fallback);
}

/**
 * A replace on a table that keeps no versions: the row updated in place, each column it declares
 * (and its parent key) set from `p_row`; a column the database holds beyond them keeps its value.
 */
function putInPlace(t: ResolvedTable): string {
  const cols = [...(t.parent ? [t.parent.fkColumn] : []), ...Object.keys(t.columns)].map(q);
  const set = cols.length
    ? `UPDATE ${q(t.name)} AS t SET (${cols.join(", ")}) = (SELECT ${cols.map((c) => `r.${c}`).join(", ")} FROM jsonb_populate_record(null::${q(t.name)}, p_row) r)
        WHERE t.id = p_id RETURNING ${rowJson(t, "t")} INTO v_row;`
    : `SELECT ${rowJson(t, "t")} INTO v_row FROM ${q(t.name)} t WHERE t.id = p_id;`;
  return `${set}
      RETURN v_row;`;
}

/** The row SQL of every collection of `schema`, and its dispatch. */
export function compileRows(schema: Schema): string {
  const lock = `CREATE OR REPLACE FUNCTION _delta_row_lock(p_coll TEXT, p_table TEXT, p_temporal BOOLEAN, p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => {
    const standing = `t.id = p_id${t.temporal ? " AND t.valid_to IS NULL" : ""}`;
    // A write that waited on another's lock finds the row it waited on stored again (a new version,
    // or put again): the row it locked is not the standing one. Asked afresh (each statement sees what
    // has committed since), a standing row is locked in its turn; none standing is not there.
    return `LOOP
        SELECT ${rowJson(t, "t")} INTO v_row FROM ${q(t.name)} t WHERE ${standing} FOR UPDATE;
        IF v_row IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ${q(t.name)} t WHERE ${standing}) THEN RETURN v_row; END IF;
      END LOOP;`;
  }, noCollection("p_coll"))}
END;
$$ LANGUAGE plpgsql;`;

  const put = `CREATE OR REPLACE FUNCTION _delta_row_put(p_coll TEXT, p_table TEXT, p_temporal BOOLEAN, p_id BIGINT, p_row JSONB, p_ts TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => (t.temporal
    ? `DELETE FROM ${q(t.name)} WHERE id = p_id AND valid_to IS NULL AND valid_from = p_ts;
      UPDATE ${q(t.name)} SET valid_to = p_ts WHERE id = p_id AND valid_to IS NULL;
      INSERT INTO ${q(t.name)} AS t SELECT * FROM jsonb_populate_record(null::${q(t.name)}, p_row || jsonb_build_object('valid_from', p_ts, 'valid_to', NULL))
        RETURNING ${rowJson(t, "t")} INTO v_row;
      RETURN v_row;`
    : putInPlace(t)), noCollection("p_coll"))}
END;
$$ LANGUAGE plpgsql;`;

  // the sequence by its name: nextval of the text 'seq_<table>'; past 2^53 - 1, no id a path can
  // name, so none is minted: the table's serial is spent (2200H, a sequence's own limit)
  const next = `CREATE OR REPLACE FUNCTION _delta_next_id(p_coll TEXT, p_table TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
BEGIN
${dispatch(schema, (_, t) => `v_id := nextval(${lit(seqOf(t.name))});`, noCollection("p_coll"))}
  IF v_id > 9007199254740991 THEN
    RAISE EXCEPTION '%: no id is left to mint: % has handed out every id to 2^53 - 1, past which no number holds one exactly',
      _delta_build_path(p_coll, '-'), 'seq_' || p_table USING ERRCODE = '2200H';
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;`;

  const clear = `CREATE OR REPLACE FUNCTION _delta_row_clear_moment(p_coll TEXT, p_table TEXT, p_id BIGINT, p_ts TIMESTAMPTZ)
RETURNS void AS $$
BEGIN
${dispatch(schema, (_, t) => (t.temporal ? `DELETE FROM ${q(t.name)} WHERE id = p_id AND valid_from = p_ts AND valid_to = p_ts;
      RETURN;` : null), noCollection("p_coll"))}
END;
$$ LANGUAGE plpgsql;`;

  const there = `CREATE OR REPLACE FUNCTION _delta_row_there(p_collection_key TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  p_coll TEXT := p_collection_key;
BEGIN
${dispatch(schema, (_, t) => `RETURN p_id IS NOT NULL AND EXISTS (SELECT 1 FROM ${standingRows(t)} WHERE id = p_id);`,
    "RETURN FALSE;   -- a collection there is not: no row of it is there")}
END;
$$ LANGUAGE plpgsql STABLE;`;

  const read = `CREATE OR REPLACE FUNCTION _delta_row_read(p_coll TEXT, p_view TEXT, p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => `SELECT _delta_strip_temporal(${rowJson(t, "t")}) INTO v_row FROM ${standingRows(t)} t WHERE t.id = p_id;
      RETURN v_row;`, noCollection("p_coll"))}
END;
$$ LANGUAGE plpgsql STABLE;`;

  const add = `CREATE OR REPLACE FUNCTION _delta_row_add(p_coll TEXT, p_table TEXT, p_row JSONB)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => {
    const keys = [...new Set(["id", ...(t.parent ? [t.parent.fkColumn] : []), ...Object.keys(t.columns), ...(t.temporal ? ["valid_from", "valid_to"] : [])])];
    const cols = keys.map((k) => q(k)).join(", ");
    return `IF p_row ?& ARRAY[${keys.map(lit).join(", ")}] AND (SELECT count(*) FROM jsonb_object_keys(p_row)) = ${keys.length} THEN
        INSERT INTO ${q(t.name)} AS t (${cols}) SELECT ${cols} FROM jsonb_populate_record(null::${q(t.name)}, p_row) RETURNING ${rowJson(t, "t")} INTO v_row;
        RETURN v_row;
      END IF;
      ${rowTexts(t, "v_row") === "v_row" ? "RETURN _delta_row_add_given(p_table, p_row);" : `v_row := _delta_row_add_given(p_table, p_row);
      RETURN ${rowTexts(t, "v_row")};`}   -- some other set of keys: the INSERT names those it gives`;
  }, noCollection("p_coll"))}
END;
$$ LANGUAGE plpgsql;`;

  return [lock, put, next, clear, there, read, add, ""].join("\n\n");
}
