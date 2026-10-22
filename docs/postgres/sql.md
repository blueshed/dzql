# The stored functions, and calling them from SQL

From `packages/dzql/bench/adapters/delta.ts`: a write as a person, in one round trip.

```ts
await pool.query("SELECT delta_apply_as($1, $2, $3) AS result",
  [String(userId), "items:", JSON.stringify([{ op: "replace", path: `/items/${id}/value`, value: 2 }])]);
```

The same from your own `plpgsql`, so a stored write still broadcasts:

```sql
CREATE FUNCTION accept_thing(p_user_id text, p_id bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN delta_apply_as(p_user_id, 'invite:' || p_id,
    jsonb_build_array(jsonb_build_object('op','replace','path','/status','value','"accepted"')));
END $$;
```

The functions are in `packages/dzql/src/sql/001a–001g-*.sql`, applied in order (`postgres.md`), each
`SECURITY INVOKER` but the fan-out (`_delta_holders`) and the serials. `generateSql` replaces
some of their helpers with SQL compiled for your documents (`postgres.md`, "Compiled SQL"); the
functions you call stay these:

- `delta_open(doc)`, `delta_open_at(doc, timestamptz)`: a document now, or as it stood.
- `delta_apply(doc, ops)`: apply, log to `_delta_ops_log`, NOTIFY.
- `delta_fetch_ops(doc, since_version)`: the log after a version.
- `delta_open_as` / `delta_open_at_as` / `delta_apply_as(user_id, …)`: the same with
  `app.user_id` set for that statement. `docTypeFromDef(def, pool, { auth })` uses them; no opt-in.
- Ledger (`001g`): `delta_apply_logged`, `delta_walk`, `delta_undo`, `delta_redo`,
  `delta_history`, and their `_as` forms (delta-doc's `ledger.md`).
- `delta_touch(collection, id)`: from a trigger a write sets off, a row it changes told as the
  write's own (below).
- `delta_snapshot(name, at)` / `delta_resolve_snapshot(name)`: pin a time to a label.
- `delta_prune_ops(interval)` (`pruneOpsLog(pool)`): trims the log and forgets names nobody holds.

## Rules

- **Read as the caller**: `delta_open_as`, never a bare `delta_open` or `SELECT` on an RLS
  table. Unbound, `app.user_id` is `''`: rows scope to nothing, and a `::bigint` cast throws.
  Bind for what the function reads, not only where `:user_id` appears.
- **Write through `delta_apply` / `delta_apply_as`**, never `INSERT` / `UPDATE` on a delta
  table: only that path versions, logs and NOTIFYs, so subscribers stay live.
- **A trigger's rows are told by `delta_touch`.** A trigger a write sets off may change rows no op
  names (a line's insert keeping its account's balance); the write tells them only when the
  trigger says so, before it changes each row:

  ```sql
  CREATE FUNCTION lines_post() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM delta_touch('accounts', NEW.account_id);   -- before the change: what changed is told
    UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
    RETURN NEW;
  END $$;
  CREATE TRIGGER lines_post AFTER INSERT ON lines FOR EACH ROW EXECUTE FUNCTION lines_post();
  ```

  Every open document that held the row before or holds it after is told what changed for it,
  as for the write's own rows. Called after the change, it is told every field. A trigger's rows
  are not in the ledger's entry: an undo walks back the write's ops, and the trigger runs again.
  Outside a write (a statement of the app's own) `delta_touch` does nothing. Working:
  `packages/dzql/tests/delta-pg/touch-pglite.test.ts`.
- **What runs as the owner answers, never reads out.** The compiled reads and writes run as the
  caller, under the policies the paths make (`rls.md`). The few `SECURITY DEFINER` functions answer
  yes, no or a name: the policies' lookups (`dzql_may__`), the ownership answers (`dzql_owns__`),
  the fan-out (`_delta_holders`, names only), and a named add (an id the writer chose), judged by
  the session's role's privileges on the table (`_delta_serial_new` / `_delta_serial_past`,
  `packages/dzql/src/compile/lookups.ts`). Each pins the path it was applied with, `pg_temp` last.
- Never edit `001*`, nor `_delta_collections` by hand: `generateSql` fills it. `_delta_docs` is a
  row type now (`_delta_find_doc`'s, compiled): nothing fills or reads its table.
- Tables need `seq_<table>` sequences: `generateSql` makes them; do not hand-write tables.
- Framework SQL older than the listener is not read around: re-apply it (`applyFramework`
  or `dzql init --upgrade`) after every upgrade, then `generateSql`, which calls it.
