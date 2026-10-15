/**
 * Compiled row SQL: the statements a write runs on a row, written for each
 * collection. The framework builds each from the table's name at run time
 * (`EXECUTE format(...)`), planned again on every call; written out, each is a
 * statement whose plan the database keeps.
 *
 * `compileRows(schema)` writes, for every collection of the schema:
 * - `_delta_row_lock`: the row as it stands (a temporal one's open version),
 *   locked for the write;
 * - `_delta_row_put`: a replace's row stored -- a temporal one a new version
 *   (one this write made gives way to it, the standing one closes), else the
 *   row again -- answered as stored;
 * - `_delta_next_id`: an add's id, from the collection's sequence;
 * - `_delta_row_clear_moment`: a temporal version this write made and took
 *   back, so an add of its id takes its place;
 * - `_delta_row_there`: is the row there now (a temporal one's open version)?
 * - `_delta_row_read`: the row as it stands, without its validity;
 * - `_delta_row_add`: an add's row stored. The framework's INSERT names the
 *   columns the row gives (`_delta_insert_sql`), so one it leaves out takes its
 *   database default: where the row gives exactly every column the schema
 *   declares (its id, parent key, columns and validity), that INSERT is one
 *   statement, written here; a row with any other keys is the framework's.
 *
 * Each answers what the framework's (`_framework`) answers, and sends any
 * collection it was not compiled for there.
 */
import { q, type Schema } from "@blueshed/delta/backend";
import { lit } from "./opens";

/** A CASE over the collections, each branch from `branch`, any other collection to `fallback`. */
function dispatch(schema: Schema, branch: (coll: string, table: Schema["tables"][string]) => string | null, fallback: string): string {
  const branches = Object.entries(schema.tables).flatMap(([coll, table]) => {
    const b = branch(coll, table);
    return b === null ? [] : [`    WHEN ${lit(coll)} THEN\n      ${b}`];
  });
  return branches.length ? `  CASE p_coll\n${branches.join("\n")}\n    ELSE ${fallback}\n  END CASE;` : `  ${fallback}`;
}

/** The row SQL of every collection of `schema`, and the dispatch to the framework's for any other. */
export function compileRows(schema: Schema): string {
  const lock = `CREATE OR REPLACE FUNCTION _delta_row_lock(p_coll TEXT, p_table TEXT, p_temporal BOOLEAN, p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => `SELECT to_jsonb(t.*) INTO v_row FROM ${q(t.name)} t WHERE t.id = p_id${t.temporal ? " AND valid_to IS NULL" : ""} FOR UPDATE;
      RETURN v_row;`, "RETURN _delta_row_lock_framework(p_coll, p_table, p_temporal, p_id);")}
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
        RETURNING to_jsonb(t.*) INTO v_row;
      RETURN v_row;`
    : `DELETE FROM ${q(t.name)} WHERE id = p_id;
      INSERT INTO ${q(t.name)} AS t SELECT * FROM jsonb_populate_record(null::${q(t.name)}, p_row) RETURNING to_jsonb(t.*) INTO v_row;
      RETURN v_row;`), "RETURN _delta_row_put_framework(p_coll, p_table, p_temporal, p_id, p_row, p_ts);")}
END;
$$ LANGUAGE plpgsql;`;

  // the sequence named as the framework names it: nextval of the text 'seq_<table>'
  const next = `CREATE OR REPLACE FUNCTION _delta_next_id(p_coll TEXT, p_table TEXT)
RETURNS BIGINT AS $$
BEGIN
${dispatch(schema, (_, t) => `RETURN nextval(${lit(`seq_${t.name}`)});`, "RETURN _delta_next_id_framework(p_coll, p_table);")}
END;
$$ LANGUAGE plpgsql;`;

  const clear = `CREATE OR REPLACE FUNCTION _delta_row_clear_moment(p_coll TEXT, p_table TEXT, p_id BIGINT, p_ts TIMESTAMPTZ)
RETURNS void AS $$
BEGIN
${dispatch(schema, (_, t) => (t.temporal ? `DELETE FROM ${q(t.name)} WHERE id = p_id AND valid_from = p_ts AND valid_to = p_ts;
      RETURN;` : null), "PERFORM _delta_row_clear_moment_framework(p_coll, p_table, p_id, p_ts);")}
END;
$$ LANGUAGE plpgsql;`;

  const there = `CREATE OR REPLACE FUNCTION _delta_row_there(p_collection_key TEXT, p_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  p_coll TEXT := p_collection_key;
BEGIN
${dispatch(schema, (_, t) => `RETURN p_id IS NOT NULL AND EXISTS (SELECT 1 FROM ${q(t.temporal ? `current_${t.name}` : t.name)} WHERE id = p_id);`,
    "RETURN _delta_row_there_framework(p_collection_key, p_id);")}
END;
$$ LANGUAGE plpgsql STABLE;`;

  const read = `CREATE OR REPLACE FUNCTION _delta_row_read(p_coll TEXT, p_view TEXT, p_id BIGINT)
RETURNS JSONB AS $$
DECLARE
  v_row JSONB;
BEGIN
${dispatch(schema, (_, t) => `SELECT _delta_strip_temporal(to_jsonb(t.*)) INTO v_row FROM ${q(t.temporal ? `current_${t.name}` : t.name)} t WHERE t.id = p_id;
      RETURN v_row;`, "RETURN _delta_row_read_framework(p_coll, p_view, p_id);")}
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
        INSERT INTO ${q(t.name)} AS t (${cols}) SELECT ${cols} FROM jsonb_populate_record(null::${q(t.name)}, p_row) RETURNING to_jsonb(t.*) INTO v_row;
        RETURN v_row;
      END IF;
      RETURN _delta_row_add_framework(p_coll, p_table, p_row);`;
  }, "RETURN _delta_row_add_framework(p_coll, p_table, p_row);")}
END;
$$ LANGUAGE plpgsql;`;

  return [lock, put, next, clear, there, read, add, ""].join("\n\n");
}
