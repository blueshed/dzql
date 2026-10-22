# Row-level security with `app.user_id`

**Permissions are a document's, never a table's.** Who may open a document, write through it and
hear it is its `owns`, a path from its row to the person, compiled into the document
(`postgres.md`, "Who may open a document"). Start there.

Row-level security is the backstop beneath the documents: the compiled reads and writes run as the
invoker, so a compiler bug in one of them (a scope, a hold, an open that reads too much) meets a
policy compiled independently from the same paths, and a person still reads and writes only a row
some document they may have holds. `generateSql` derives it; nothing is written by hand.

## Where it applies, and where it does not

- **On delta's socket**: a page drawn in the browser, delta's client, each socket signed in
  (`openStore`'s `auth`). Its opens, writes, history and walks run as that person, so `owns` and
  the policies both hold. Only for a pool whose role is neither a superuser nor `BYPASSRLS`
  (below): `openStore` warns as it opens, on a server, when its role is either.
- **Not for an app dzql draws** (`dzql/rendering`, the thin client): its kernel reads each document
  once, in the process, as no one (`src/rendering/documents.ts`), and draws each page from that, so
  neither `owns` nor row-level security ever meets a person there. What protects its data is each
  resource's `resolveDoc` (which document a person sees) and `permit` (what they may write), and
  how its documents are cut: a person is drawn only what the document they see holds, so keep each
  to what its people may read (`packages/dzql/src/rendering/resources/resource.ts`; the dzql-app
  skill's `documents.md`).

## Derived from the paths

For each table **every** document holding it says by a path (`owns` as a string), `generateSql`
writes `dzql_may__<collection>(row, check)`: may the person (`app.user_id`) have a document that
holds this row? A document's path is followed from the row's own values where the table is its
root, from the root row it hangs from where it is included, and from any of its root rows where
the table hangs from none. The table gets RLS enabled and **forced**, and one policy, `dzql_owns`:
a row is read where that answers yes (`USING`), and written where it still does (`WITH CHECK`,
so a row is never handed away here either: SQLSTATE 42501, a 403). `packages/dzql/src/compile/policies.ts`.

- A table some document holds with no path (none, a function, `shared: true`), or that no
  document holds, says nothing a policy can: it is left as the app set it (below, by hand). One
  dzql governed before is let go when a document without a path comes to hold it: its policy
  off, and RLS with it where no policy of the app's is left.
- A row is read as its person only when `app.user_id` is bound: with `auth.asSqlArg` set, every
  `docTypeFromDef(def, pool, { auth })` call is (the `*_as` functions); `withAppAuth` binds it for
  your own queries. Unbound, a table on a path reads as empty.

## Who it holds

**A superuser bypasses RLS, even forced, and so does a role with `BYPASSRLS`** (PGlite's
`postgres`; the repo's compose `dzql_test`; the role many hosts hand you first). With `auth`,
`openStore` warns as it opens on a server whose pool's role is either
(`packages/dzql/tests/delta-pg/postgres-pool.test.ts`). Serve the documents as a role that is neither:

- **One role** (`openStore` with one pool): the role that applies the SQL owns the tables, and
  serves them. Forced, its own queries meet the policies too.
- **Two roles**: an admin role applies the SQL (and owns the tables); the app's pool logs in as
  another, granted `USAGE` on the schema, `SELECT, INSERT, UPDATE, DELETE` on its tables and
  `USAGE, SELECT` on its sequences.

What reads past the policies is the owner's, and says only yes, no or a name: the policies' own
lookups (`dzql_may__`), the ownership answers (`dzql_owns__`) and the fan-out (`_delta_holders`).
Each is `SECURITY DEFINER` and raises `dzql.definer` for its own reads, and each policy lets the
table's owner past while it is raised; any other role raising it gains nothing. The fan-out finds
who holds a row the writer may not read (Bob's card on Alice's list reaches her board) and
answers their names; what each is told is worked out as the writer, from the rows the write read
and wrote. A policy that let the writer read those rows for the fan-out would let it read them in
any query, so there is none.

The owner's maintenance raises it too: `exportTables`, `importTables` (so the stories' store) and
`migrate` read and write every row as the owner. So does `openStore`'s `owner`, the server's own
caller in its process (a command, a job), raising it for each call it makes through the documents:
it is no person, so a write of its keeps every reach, and its writes are the documents' (their
rule, the ledger, the fan-out). A seed or a report of your own on a forced table binds a person,
goes through them, or goes through the owner.

## By hand, for a table no path governs

From `packages/dzql/examples/delta/todos-vs-rls/rls.sql`, whose documents say who owns them by a
function: you see a todo you own or your team's; you write only your own.

```sql
ALTER TABLE example_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE example_todos FORCE  ROW LEVEL SECURITY;

CREATE POLICY example_todos_visibility ON example_todos
  FOR ALL
  USING (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::int
    OR team_id IN (SELECT team_id FROM example_team_members
                   WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::int)
  )
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::int);

GRANT USAGE ON SCHEMA public TO example_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO example_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO example_app;
```

`NULLIF(…, '')` keeps an unbound session from throwing on the cast. An implied document's root is
made inside `delta_apply`, under the writer's `app.user_id`, so `WITH CHECK` sees it. A temporal
table's `current_<table>` view is `security_invoker` (Postgres 15+), so a policy holds through it.

## Gotchas

- **RLS filters reads, not the channel.** The listener reads the change log with no identity;
  one name several identities open hands each every row written through it. One name per
  owner, checked by its `owns` path (delta-doc's `ownership.md`). `packages/dzql/tests/delta-pg/postgres-rls.test.ts` pins it as a
  `NOSUPERUSER` role.
- **No bare `pool.query` on a forced table**: go through `docTypeFromDef(def, pool, { auth })`,
  or `withAppAuth` / `*_as`, so `app.user_id` is bound. A custom document's `query` and
  `recompute` must bind it themselves (`withAppAuth`).
- `SET LOCAL` cannot bind parameters: use `set_config(name, value, true)`.
- **Apply the framework, then `generateSql`, as the role that owns the tables**: `_delta_govern`
  (001b) puts each policy on, which only the owner may, and names that role as the one let past.
- **A 5xx names nothing.** A bad prefix, root or scope key, or anything else the server fails at,
  is answered `The server failed: what went wrong is in its log`, and the database's words
  (tables, constraints, types) are logged, never sent. A 4xx is in the database's words or
  delta's, and may name a column or a constraint: do not put tenant-sensitive identifiers in
  prefixes (`boards:42`, not `tenant-42:`) or in constraint names.
- `packages/dzql/tests/delta-pg/rls-backstop-pglite.test.ts` shows each: a compiled check made wrong on purpose
  leaks as the superuser and is refused as a role RLS holds; and `tests/delta/permissions-pglite.test.ts`
  answers delta's permission cases as such a role, the same as the superuser.
