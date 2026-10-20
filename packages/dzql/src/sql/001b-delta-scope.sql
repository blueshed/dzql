-- =========================================================================
-- Delta-doc: doc lookup, scope resolution, temporal helpers
-- =========================================================================

-- ---------------------------------------------------------------------------
-- _delta_find_doc: match a doc name to its definition
-- ---------------------------------------------------------------------------

-- The document a name is of: of the longest prefix it starts with (exactly, not
-- LIKE: a prefix with `_` or `%` in it means those). generateSql writes each
-- document in (compileLookups); before it is applied there is none.
CREATE OR REPLACE FUNCTION _delta_find_doc(p_doc_name TEXT)
RETURNS _delta_docs LANGUAGE sql STABLE AS $$ SELECT NULL::_delta_docs; $$;

-- ---------------------------------------------------------------------------
-- _delta_resolve_scope: turn a doc name + def into WHERE clause + metadata
--
-- Scope binding syntax:  { "column": "op:param" }
--   "=:name"      → column = <value>           (equality)
--   "<=:name"     → column <= <value>           (range)
--   ">=:name"     → column >= <value>           (range)
--   "like:name"   → column ILIKE <value>%       (prefix search)
--   "at:name"     → reserved: temporal snapshot  (not a WHERE condition)
--   ":name"       → shorthand for "=:name"
--
-- Named params are resolved positionally from the colon-separated doc ID.
-- Empty resolved values are skipped (no filter applied for that entry).
--
-- A value is read as its column takes it, by one grammar on every backend (the
-- SQLite backend's scopeValue is its twin), and one it cannot take is refused
-- (22P02, a 400): an integer's is digits, signed, up to 2^53 - 1 (not 1_000 or
-- 0x10, which Postgres's own cast takes); a real's a finite decimal number (not
-- Infinity, NaN or 0x10), one a double holds; an id's or a parent key's a whole
-- number, or text no row here has (below); a timestamptz's a date, YYYY-MM-DD,
-- the instant midnight UTC begins it (the cast's own 22007 would be a 500). Other
-- types are left to the column's cast, which reads them as SQLite does.
--
-- Returns JSONB:
--   { "where":  "SQL WHERE clause",
--     "values": { equality bindings for ADD ops },
--     "mode":   "list" | "single",
--     "at":     "2026-06-01" | null }
--
-- With p_refuse false a value refused is not raised: the answer is the scope
-- that holds nothing ("where" FALSE, list mode), with "refused" its message --
-- how the fan-out reads a name opened before a rule refused it (_delta_doc_holds).
-- ---------------------------------------------------------------------------

-- generateSql writes each document's resolver (compileResolve), and sends a
-- name to its own; before it is applied there is no document.
CREATE OR REPLACE FUNCTION _delta_resolve_scope(p_def _delta_docs, p_doc_name TEXT, p_refuse BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001'; END $$;

-- The resolver as every caller but the fan-out asks it: a value refused is raised.
CREATE OR REPLACE FUNCTION _delta_resolve_scope(p_def _delta_docs, p_doc_name TEXT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT _delta_resolve_scope(p_def, p_doc_name, TRUE);
$$;

-- ---------------------------------------------------------------------------
-- _delta_scope_row: the scope's equality values (_delta_resolve_scope's
-- `values`, the name's text), as a list-mode add of a root row is given them:
-- as the scope's condition reads each. The condition casts its text
-- to the column's type; jsonb_populate_record does the same with a JSON string
-- for every type but json, where it keeps the string whole -- a name's 5 stored
-- as "5", which `wishes = '5'` does not match. So a json column's value is the
-- JSON its text is (5 is 5, "5" the string); every other column's stays text,
-- for the column to cast. The SQLite backend's scopeValue reads it the same way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _delta_scope_row(p_columns JSONB, p_values JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(
           k, CASE WHEN p_columns->k->>'type' = 'json' THEN (v #>> '{}')::jsonb ELSE v END), '{}'::jsonb)
    FROM jsonb_each(COALESCE(p_values, '{}'::jsonb)) AS x(k, v);
$$;

-- ---------------------------------------------------------------------------
-- _delta_row_in_scope: may this doc address this row?
--
-- As the document's read filters, so the rule is simply "you may write what
-- you may read".
--
-- A write names rows by id, so without this a client holding `tenant:1` could
-- name a row of `tenant:2` and remove or overwrite it: delta_apply gates every
-- row-addressed write through here.
-- Returning FALSE for a row that exists but is invisible (including one hidden
-- by RLS) is deliberate — it keeps "forbidden" and "absent" indistinguishable
-- so the gate can't be used to probe for ids.
-- ---------------------------------------------------------------------------

-- generateSql sends each document to its own (dzql_in_scope__<slug>); before
-- it is applied there is no document.
CREATE OR REPLACE FUNCTION _delta_row_in_scope(p_def _delta_docs, p_doc_name TEXT, p_collection_key TEXT, p_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001'; END $$;

-- ---------------------------------------------------------------------------
-- Who holds a row: the fan-out
--
-- A write is told to every document that holds a row it changed -- the one
-- written through, and every other opened document over the same rows -- as
-- the SQLite backend tells its open documents. These answer, from a row's
-- values (as it was before the write, or as it is after), which documents
-- hold it; delta_apply tells each what changed for it.
-- ---------------------------------------------------------------------------

-- _delta_doc_holds: does the document `p_doc_name` (of `p_def`) hold `p_row`
-- of `p_coll`? Judged on the row's values, so a row as it was before a write
-- is judged as well as one as it is after -- the same rule delta_open reads by.
-- generateSql sends each document to its own (dzql_holds__<slug>); before it
-- is applied there is no document.
CREATE OR REPLACE FUNCTION _delta_doc_holds(p_def _delta_docs, p_doc_name TEXT, p_coll TEXT, p_row JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$ BEGIN RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001'; END $$;

-- _delta_holders: the documents that hold `p_row` of `p_coll` -- every one
-- open now (a name in _delta_held), and the writer's own `p_writer`.
-- A single-mode document of an unscoped definition is found by its name,
-- prefix || the root the row hangs from; a scoped or list-mode one, or one
-- holding an unparented collection, by the open names of its prefix. So a
-- write costs what is open, not what was ever opened.
--
-- Before it asks, it takes its prefix's lock, shared, until the write commits:
-- an open of that prefix holds its name and waits for it (_delta_hold), so a
-- name held from now is seen here, and a write that asked before is read by
-- the open. VOLATILE, so the question is asked after the lock -- and so a
-- write runs at READ COMMITTED: a transaction that reads from one snapshot
-- (REPEATABLE READ, SERIALIZABLE) would not see a name held after it began,
-- and is refused (SQLSTATE 0A000).
--
-- SECURITY DEFINER, with pg_temp last on its path: who holds a row
-- is worked out as the functions' owner, not the writer, so a parent row the writer's RLS hides (another's
-- list, under another's board) does not hide the document that holds it. It
-- answers document names, never a row; each document is told only what it
-- holds (a caller may ask it of a row it makes up, and learn which open
-- documents would hold it). What each is told (_delta_told) is worked out as
-- the writer, from the rows the write itself read and wrote.
--
-- Why a definer, and not policies that let the fan-out read (todo #19): a
-- policy cannot tell the fan-out's reads from any other query of the same
-- role, so one that let the writer read another document's rows to find who
-- holds them would let the writer read those rows anywhere -- the backstop
-- gone for every table on a path. A definer that answers only names keeps
-- every row behind the policies, and its own lookups are the compiled holds,
-- which hand back nothing. It sees past RLS where its owner does: the role
-- that applied the SQL, by the policies' own word (_delta_govern, which lets
-- that role past while dzql.definer is raised, as the compiled function does),
-- or with BYPASSRLS.
-- generateSql writes it (compileHolders), each document asked by its own
-- lookups; before it is applied no document holds a row.
CREATE OR REPLACE FUNCTION _delta_holders(p_coll TEXT, p_row JSONB, p_writer TEXT)
RETURNS TEXT[] LANGUAGE sql VOLATILE SECURITY DEFINER AS $$ SELECT ARRAY[]::text[]; $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION _delta_holders(TEXT, JSONB, TEXT) SET search_path = %s, pg_temp', COALESCE(NULLIF(current_setting('search_path'), ''), 'public'));
END $$;

-- _delta_rescopes: does `p_value`, written over a row of `p_coll` as it was
-- (`p_was`), change a column a list document rooted there scopes by, where it
-- holds rows that hang under its roots? Then those rows may arrive in a list or
-- leave one, and are carried as a row moved to another parent carries them
-- (delta_apply). generateSql writes it (compileRescopes); before it is
-- applied no list scopes by any.
CREATE OR REPLACE FUNCTION _delta_rescopes(p_coll TEXT, p_was JSONB, p_value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT FALSE; $$;

-- ---------------------------------------------------------------------------
-- _delta_govern: a table's row-level security, as generateSql derives it from
-- the documents' paths (compilePolicies, todo #19). Given `p_may`, the table's
-- dzql_may__<collection>(row, check): every document holding it says a path,
-- so its policy, dzql_owns, lets a person read a row some document they may
-- have holds (USING), and write one that stays so (WITH CHECK); RLS enabled
-- and FORCED, so the table's owner meets it too when it is the app's role.
-- Past it: the role applying this (the owner, which owns the definer
-- functions too) while `dzql.definer` is raised -- inside those functions,
-- which raise it for their own reads and put it back; another role raising it
-- gains nothing. A superuser, or a role with BYPASSRLS, is never held by RLS.
-- Given none: the table says nothing a policy can (some document holds it
-- with no path, or none does); dzql's policy, if it made one, is taken off,
-- and RLS with it where no policy of the app's own is left.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _delta_govern(p_table TEXT, p_may TEXT) RETURNS void AS $$
DECLARE
  v_past TEXT := format('(current_user = %L AND current_setting(''dzql.definer'', true) = ''on'')', current_user);
  v_ours BOOLEAN := EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = p_table AND policyname = 'dzql_owns');
BEGIN
  IF v_ours THEN EXECUTE format('DROP POLICY dzql_owns ON %I', p_table); END IF;
  IF p_may IS NULL THEN
    IF v_ours AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = p_table) THEN
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY', p_table);
    END IF;
    RETURN;
  END IF;
  EXECUTE format('CREATE POLICY dzql_owns ON %I USING (%s OR %I(%I, FALSE)) WITH CHECK (%s OR %I(%I, TRUE))',
    p_table, v_past, p_may, p_table, v_past, p_may, p_table);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY', p_table);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- _delta_strip_temporal: remove valid_from/valid_to/override from a JSONB row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _delta_strip_temporal(p_row JSONB)
RETURNS JSONB AS $$ SELECT p_row - 'valid_from' - 'valid_to' - 'override'; $$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- The schema is the contract (reference/migrations.md): a process writes by
-- the columns its own schema declares. _delta_cols: a collection's columns as
-- the process writing declares them -- `delta.declared`, set for the call by its
-- listener (`{ <collection>: <columns_def> }`, createDocListener's `schema`) --
-- else as the database last declared them (_delta_collections, generateSql).
-- Two versions on one database each validate, default and replace by their
-- own, whichever started last. _delta_stored_columns: every column the table
-- has, by name -- a walk puts a row back as the ledger stored it, a column this
-- process does not declare too.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _delta_cols(p_collection_key TEXT, p_columns_def JSONB)
RETURNS JSONB AS $$
  SELECT COALESCE(NULLIF(current_setting('delta.declared', true), '')::jsonb -> p_collection_key, p_columns_def);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION _delta_stored_columns(p_table TEXT)
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(attname::text ORDER BY attnum), '{}')
    FROM pg_attribute
   WHERE attrelid = to_regclass(quote_ident(p_table)) AND attnum > 0 AND NOT attisdropped;
$$ LANGUAGE sql STABLE;

-- _delta_insert_sql: the INSERT of a new row that names only the columns the
-- row gives (its id, parent key, declared columns and validity; a row put back
-- by a walk, every column it was stored with), so a column it does not give --
-- one a migration added NOT NULL with a default -- takes its database default,
-- as SQLite's insertRow gives it. Run with the row as $1; RETURNING may follow.
CREATE OR REPLACE FUNCTION _delta_insert_sql(p_table TEXT, p_row JSONB)
RETURNS TEXT AS $$
  SELECT format('INSERT INTO %1$I AS t (%2$s) SELECT %2$s FROM jsonb_populate_record(null::%1$I, $1)', p_table,
    (SELECT string_agg(format('%I', k), ', ') FROM jsonb_object_keys(p_row) AS k));
$$ LANGUAGE sql STABLE;
