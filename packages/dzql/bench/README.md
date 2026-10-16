# Bench: a write's cost under row-level security

Measures delta's write, `delta_apply_as(user, doc, ops)` in one round trip, its document compiled
(generateSql's), against a raw `UPDATE` as the baseline. Every timed write
runs as an app role, `bench_app` (NOSUPERUSER NOBYPASSRLS), so the policy is evaluated; the bench
refuses to run otherwise. Set-up (the framework, the table, the seed, the role) runs as the admin the
URL names.

## Run

```
bun run test:setup     # the test compose on localhost:5433
bun run bench          # 10_000 single-field updates per adapter
bun run test:teardown
```

Options via env:

| Var | Default | Meaning |
|---|---|---|
| `BENCH_ITERATIONS` | `10000` | measured iterations per adapter |
| `BENCH_WARMUP` | `200` | discarded iterations before measurement |
| `BENCH_PG_URL` | `$DATABASE_URL`, else `postgres://dzql_test:dzql_test@localhost:5433/dzql_test` | target DB (as an admin) |

## What it measures

Each adapter updates a single `value` column on a row owned by `user_id=1`, under a policy that
reads `NULLIF(current_setting('app.user_id', true), '')` (a pooled connection reads a
transaction-local setting as `''` once that transaction is done).

| Adapter | Per op |
|---|---|
| `raw-postgres` | `WITH _ AS (set_config…) UPDATE …` |
| `delta` | `delta_apply_as`, its document compiled from its definition |

Until the framework retired (todo #26) the bench also ran delta's write with the framework's reads
and checks: the 2026-10-15 results compare the two.

Results: [results-2026-10-15.md](./results-2026-10-15.md). The 0.3.0 results
([results-0.3.0.md](./results-0.3.0.md)) were taken as a superuser, so RLS was bypassed: they say
nothing about it.

## Fan-out

After the table, one write through a scoped document (`fanout:1`) with 10 documents open
through a listener and 10, 1,000 and 100,000 names opened once and let go. A write asks the
names open now (`_delta_held`, todo #73), so its cost stays flat as the names ever opened grow.
Before 0.13.0 it asked every name in `_delta_versions`: p50 1.7 ms, 80 ms and 10.6 s.
