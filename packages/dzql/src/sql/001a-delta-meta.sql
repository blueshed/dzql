-- =========================================================================
-- Delta-doc: metadata tables
-- =========================================================================
-- Runtime schema registry populated by TypeScript (createTables / registerDocs).
-- =========================================================================

CREATE TABLE IF NOT EXISTS _delta_collections (
  collection_key   TEXT PRIMARY KEY,
  table_name       TEXT NOT NULL,
  columns_def      JSONB NOT NULL DEFAULT '{}',
  parent_collection TEXT,
  parent_fk        TEXT,
  temporal         BOOLEAN NOT NULL DEFAULT TRUE,
  cascade_on       JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS _delta_docs (
  prefix           TEXT PRIMARY KEY,
  root_collection  TEXT NOT NULL,
  include          TEXT[] NOT NULL DEFAULT '{}',
  scope            JSONB NOT NULL DEFAULT '{}'
);

-- An implied document is there before its root row is: it opens
-- empty, and its first write makes the row -- as on SQLite and ./json.
ALTER TABLE _delta_docs ADD COLUMN IF NOT EXISTS implied BOOLEAN NOT NULL DEFAULT FALSE;

-- The columns a document holds of a collection it names: collection
-- key -> its column names. The row's id and parent key it holds always; a
-- collection not named, whole. It is opened, told and written by those alone.
ALTER TABLE _delta_docs ADD COLUMN IF NOT EXISTS held JSONB NOT NULL DEFAULT '{}';

-- Each document and collection is compiled by generateSql: these generic
-- forms, made by earlier versions, are dropped.
DROP FUNCTION IF EXISTS _delta_collection_framework(text);
DROP FUNCTION IF EXISTS _delta_assert_fields_framework(text, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS _delta_temporal_where(timestamptz, text);
DROP FUNCTION IF EXISTS _delta_find_doc_framework(text);
DROP FUNCTION IF EXISTS _delta_resolve_scope_framework(_delta_docs, text, boolean);
DROP FUNCTION IF EXISTS _delta_row_in_scope_framework(_delta_docs, text, text, bigint);
DROP FUNCTION IF EXISTS _delta_chain_root(text, jsonb, text);
DROP FUNCTION IF EXISTS _delta_doc_holds_framework(_delta_docs, text, text, jsonb);
DROP FUNCTION IF EXISTS _delta_holders_framework(text, jsonb, text, text[]);
DROP FUNCTION IF EXISTS _delta_load_collection(text, text, bigint, timestamptz);
DROP FUNCTION IF EXISTS _delta_load_collection_all(text, timestamptz);
DROP FUNCTION IF EXISTS _delta_read_list(_delta_docs, text, timestamptz);
DROP FUNCTION IF EXISTS _delta_show_doc(_delta_docs, jsonb, boolean);
DROP FUNCTION IF EXISTS _delta_open_framework(text, boolean);
DROP FUNCTION IF EXISTS _delta_serial_past_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_serial_new_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_cascade_remove_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_cascade_rows_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_hanging_rows_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_told_framework(_delta_docs, text, jsonb);
DROP FUNCTION IF EXISTS _delta_row_there_framework(text, bigint);
DROP FUNCTION IF EXISTS _delta_held_columns(_delta_docs, text, jsonb);
DROP FUNCTION IF EXISTS _delta_root_there_framework(_delta_docs, text, jsonb, text, bigint);
DROP FUNCTION IF EXISTS _delta_write_columns_framework(_delta_docs, text, jsonb);
DROP FUNCTION IF EXISTS _delta_row_lock_framework(text, text, boolean, bigint);
DROP FUNCTION IF EXISTS _delta_row_put_framework(text, text, boolean, bigint, jsonb, timestamptz);
DROP FUNCTION IF EXISTS _delta_next_id_framework(text, text);
DROP FUNCTION IF EXISTS _delta_row_clear_moment_framework(text, text, bigint, timestamptz);
DROP FUNCTION IF EXISTS _delta_row_add_framework(text, text, jsonb);
DROP FUNCTION IF EXISTS _delta_row_read_framework(text, text, bigint);
DROP FUNCTION IF EXISTS _delta_open_at_framework(text, timestamptz);
DROP FUNCTION IF EXISTS _delta_same_framework(text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS _delta_row_standing_framework(text, bigint);

-- _delta_collection: a collection's definition (NULL fields: there is none).
-- generateSql writes each collection in (compileLookups); before it is applied,
-- there is none.
CREATE OR REPLACE FUNCTION _delta_collection(p_key TEXT)
RETURNS _delta_collections LANGUAGE sql STABLE AS $$ SELECT NULL::_delta_collections; $$;

CREATE TABLE IF NOT EXISTS _delta_versions (
  doc_name TEXT PRIMARY KEY,
  version  BIGINT NOT NULL DEFAULT 0
);

-- The documents open now: a row for each name a listener has
-- subscribers for, and which listener. A write's fan-out asks these names, not
-- every name ever opened. A listener is alive while its connection holds its
-- lock (001c, _delta_holder_live); a dead one's rows are cleared.
CREATE SEQUENCE IF NOT EXISTS _delta_holder_ids AS integer;
CREATE TABLE IF NOT EXISTS _delta_held (
  doc_name TEXT NOT NULL,
  holder   INTEGER NOT NULL,
  PRIMARY KEY (doc_name, holder)
);

CREATE TABLE IF NOT EXISTS _delta_ops_log (
  id         BIGSERIAL PRIMARY KEY,
  doc_name   TEXT NOT NULL,
  version    BIGINT NOT NULL,
  ops        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delta_ops_log_fetch
  ON _delta_ops_log (doc_name, version);

-- The write itself, once, for the custom documents that watch its rows (todo
-- #44): on the writer's entry, the ops as delta_apply applied them -- each row
-- it changed as it now is, or its remove -- so a custom document hears a write
-- once, as on SQLite, and not once for each document it was told to (where a
-- row that left a document is a remove, which is not a delete). Kept only where
-- they differ from what the writer was told: NULL is heard as told, so an
-- entry whose ops are the write, and one logged some other way (a direct
-- _delta_bump_and_notify), carry none. '[]' on the other documents' entries of
-- the same write.
ALTER TABLE _delta_ops_log ADD COLUMN IF NOT EXISTS applied JSONB;

-- =========================================================================
-- Pure helpers — composed by every read/write/ops function below
-- =========================================================================

-- Build an RFC 6901 JSON Pointer, each segment escaped (~ as ~0, / as ~1).
--   _delta_build_path('sites', '42')  -> '/sites/42'
--   _delta_build_path('venues')       -> '/venues'
CREATE OR REPLACE FUNCTION _delta_build_path(p_collection TEXT, p_id TEXT DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '/' || replace(replace(p_collection, '~', '~0'), '/', '~1')
      || CASE WHEN p_id IS NULL THEN '' ELSE '/' || replace(replace(p_id, '~', '~0'), '/', '~1') END;
$$;

-- Split an RFC 6901 JSON Pointer into its unescaped segments -- the grammar of
-- splitPath in src/core.ts: '' is the whole document, every other path starts
-- with '/', an empty segment is a key, and a '~' not followed by 0 or 1 is an
-- error. SQLSTATE 22023 (invalid_parameter_value) answers 400 on the wire.
--   _delta_split_path('/sites/42')  -> ARRAY['sites','42']
--   _delta_split_path('/a~1b/c~0d') -> ARRAY['a/b','c~d']
--   _delta_split_path('sites')      -> raises
CREATE OR REPLACE FUNCTION _delta_split_path(p_path TEXT)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_path = '' THEN RETURN ARRAY[]::text[]; END IF;
  IF p_path IS NULL OR left(p_path, 1) <> '/' THEN
    RAISE EXCEPTION 'Invalid JSON Pointer "%": a path starts with "/" ("" is the whole document)', p_path
      USING ERRCODE = '22023';
  END IF;
  IF p_path ~ '~([^01]|$)' THEN
    RAISE EXCEPTION 'Invalid JSON Pointer "%": "~" is written "~0" and "/" is written "~1"', p_path
      USING ERRCODE = '22023';
  END IF;
  RETURN ARRAY(
    SELECT replace(replace(seg, '~1', '/'), '~0', '~')
      FROM unnest(regexp_split_to_array(substr(p_path, 2), '/')) WITH ORDINALITY AS t(seg, n)
     ORDER BY n
  );
END;
$$;

-- A row id from a path segment. This backend keeps BIGINT ids it mints from
-- seq_<table>, so anything else is a client error (SQLSTATE 22P02 → 400) that
-- names the fix. So is a number past 2^53 - 1: a row is read out as JSON, and
-- no JavaScript number holds such an id exactly, so the row would be told under
-- another (the SQLite backend refuses it too, in these words, after the op's
-- path: `p_path`, else the row's). Digits name their number, however many there are ("007" is 7).
DROP FUNCTION IF EXISTS _delta_row_id(text, text);   -- its first form named no op's path
CREATE OR REPLACE FUNCTION _delta_row_id(p_collection TEXT, p_segment TEXT, p_path TEXT DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_segment IS NULL OR p_segment !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'row id "%" in /%/% is not a number: Postgres mints row ids -- add to /%/- and read the id from the echo',
      p_segment, p_collection, p_segment, p_collection
      USING ERRCODE = '22P02';
  END IF;
  IF p_segment::numeric > 9007199254740991 THEN
    RAISE EXCEPTION '%: Row id % is past 2^53 - 1, which no number holds exactly -- add to % and read the id from the echo',
      COALESCE(p_path, _delta_build_path(p_collection, p_segment)), p_segment, _delta_build_path(p_collection, '-')
      USING ERRCODE = '22P02';
  END IF;
  RETURN p_segment::bigint;
END;
$$;

-- Refuse a value that is not an object, names a field the collection does
-- not have, or gives a column a value not of its type (SQLSTATE 22023 → 400),
-- so nothing is stored otherwise than told. id, the parent key and
-- the temporal columns are the row's own. By the columns given (`p_columns`): a
-- set the compiler did not write in (another version's, `delta.declared`; a
-- walk's, as its entry was stored) is checked here.
-- In delta's words, as SQLite's validateOps says each: after the op's path
-- (`p_path`), and a field of a row's value (not `p_field`, one field's op) after
-- the field's. An op wrong in several ways is told every refusal, joined by
-- "; ": the fields there are not, then each value not as it may be written,
-- then each required field it leaves out (`p_missing`, _delta_missing: 23502
-- when that is all), each kind by name (COLLATE "C", as delta sorts them). An
-- add (`p_add`) may leave its parent key null: its document's root, or found in scope.
DROP FUNCTION IF EXISTS _delta_assert_fields_declared(text, jsonb, text, jsonb);   -- its first form named no op's path
DROP FUNCTION IF EXISTS _delta_assert_fields(text, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS _delta_assert_fields_declared(text, jsonb, text, jsonb, text, boolean, boolean);   -- its second told no field left out
DROP FUNCTION IF EXISTS _delta_assert_fields(text, jsonb, text, jsonb, text, boolean, boolean);
CREATE OR REPLACE FUNCTION _delta_assert_fields_declared(
  p_collection TEXT, p_columns JSONB, p_parent_fk TEXT, p_value JSONB, p_path TEXT, p_add BOOLEAN, p_field BOOLEAN, p_missing TEXT
) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_unknown TEXT;
  v_types TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION '%: % value must be an object', p_path, CASE WHEN p_add THEN 'Add' ELSE 'Replace' END USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(p_path || ': Unknown field: ' || k, '; ' ORDER BY k COLLATE "C") INTO v_unknown
    FROM jsonb_object_keys(p_value) AS k
   WHERE NOT COALESCE(p_columns, '{}'::jsonb) ? k
     AND k NOT IN ('id', 'valid_from', 'valid_to')
     AND k IS DISTINCT FROM p_parent_fk;
  -- each field's value as it may be written, as SQLite's validateOps asks: of its column's type, not
  -- cast (5 into a text column is "5"); null only where its column takes it; the parent key, given,
  -- a whole number or text (text that is no number's digits is refused when the column casts it,
  -- 22P02, 400, as SQLite refuses a key that names no row), null only where an add leaves it
  SELECT string_agg(CASE WHEN p_field THEN p_path ELSE p_path || '/' || k END || ': ' || m, '; ' ORDER BY k COLLATE "C") INTO v_types
    FROM (
      SELECT k, CASE
        WHEN k = p_parent_fk THEN CASE
          WHEN jsonb_typeof(val) = 'null' THEN CASE WHEN p_add THEN NULL ELSE k || ' cannot be null' END
          WHEN jsonb_typeof(val) = 'string' OR (jsonb_typeof(val) = 'number' AND val::text::numeric = trunc(val::text::numeric)) THEN NULL
          ELSE k || ' must be an id: an integer, or text' END
        WHEN c IS NULL THEN NULL
        WHEN jsonb_typeof(val) = 'null' THEN CASE WHEN COALESCE((c->>'nullable')::boolean, false) THEN NULL ELSE k || ' cannot be null' END
        WHEN CASE c->>'type'
          WHEN 'text' THEN jsonb_typeof(val) = 'string'
          WHEN 'integer' THEN jsonb_typeof(val) = 'number' AND val::text::numeric = trunc(val::text::numeric)
          WHEN 'real' THEN jsonb_typeof(val) = 'number'
          WHEN 'boolean' THEN jsonb_typeof(val) = 'boolean'
          -- ISO-8601, as isIsoTime (src/postgres/schema.ts) reads it; a day off the calendar is refused by the cast (22008, 400)
          WHEN 'timestamptz' THEN jsonb_typeof(val) = 'string' AND (val #>> '{}') ~ '^\d{4}-\d{2}-\d{2}([T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]([01]\d|2[0-3])(:?[0-5]\d)?)?)?$'
          ELSE TRUE END THEN NULL
        ELSE k || ' must be ' || CASE c->>'type' WHEN 'text' THEN 'a string' WHEN 'integer' THEN 'an integer'
          WHEN 'real' THEN 'a number' WHEN 'boolean' THEN 'a boolean' ELSE 'an ISO-8601 time' END
        END AS m
        FROM jsonb_each(p_value) AS v(k, val), LATERAL (SELECT p_columns->k AS c) col
    ) AS checked
   WHERE m IS NOT NULL;
  IF v_unknown IS NOT NULL OR v_types IS NOT NULL THEN
    RAISE EXCEPTION '%', concat_ws('; ', v_unknown, v_types, p_missing) USING ERRCODE = '22023';
  END IF;
  IF p_missing IS NOT NULL THEN
    RAISE EXCEPTION '%', p_missing USING ERRCODE = '23502';
  END IF;
END;
$$;

-- The checks every write asks: generateSql (`compileColumns`) replaces this
-- with one that checks each column set it compiled by its own statements, and
-- any other by the columns given.
CREATE OR REPLACE FUNCTION _delta_assert_fields(
  p_collection TEXT, p_columns JSONB, p_parent_fk TEXT, p_value JSONB, p_path TEXT, p_add BOOLEAN, p_field BOOLEAN, p_missing TEXT
) RETURNS void LANGUAGE sql IMMUTABLE AS $$ SELECT _delta_assert_fields_declared(p_collection, p_columns, p_parent_fk, p_value, p_path, p_add, p_field, p_missing); $$;

-- _delta_missing: the required columns of `p_columns` (not nullable, no
-- default) a row's value leaves out, in delta's words after the op's path
-- (`p_path`), by name, joined by "; " -- or NULL. A row added, or replaced
-- whole (RFC 6902: a replace of the row is the row), is asked it before
-- whether the row is there, and it is told after the value's other refusals
-- (_delta_assert_fields).
CREATE OR REPLACE FUNCTION _delta_missing(p_columns JSONB, p_value JSONB, p_path TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(p_path || ': Required field missing: ' || col_key || ' (give it a value, or declare a default or make it nullable in the schema)', '; ' ORDER BY col_key COLLATE "C")
    FROM jsonb_each(p_columns) AS x(col_key, col_def)
   WHERE NOT COALESCE(p_value ? col_key, FALSE) AND NOT COALESCE((col_def->>'nullable')::boolean, false) AND NOT col_def ? 'default';
$$;

-- Pick the source relation for a collection.
--   temporal + no timestamp → current_<table> view
--   temporal + timestamp    → base <table> (the caller filters by its time)
--   non-temporal            → base <table>
CREATE OR REPLACE FUNCTION _delta_source_view(
  p_table_name TEXT, p_temporal BOOLEAN, p_at TIMESTAMPTZ DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_temporal AND p_at IS NULL THEN 'current_' || p_table_name
    ELSE p_table_name
  END;
$$;
