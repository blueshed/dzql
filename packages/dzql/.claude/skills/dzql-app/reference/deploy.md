# Deploying (`Dockerfile`, a Postgres server)

In production an app is `bun start` (`NODE_ENV=production`) on a Postgres server at
`DATABASE_URL`. PGlite is for development and the tests: never deploy it (it needs far more memory
than a small server has). The starter's `Dockerfile` is the whole of the container:

```dockerfile
# Dockerfile (its comments trimmed)
FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY . .
ENV PID_FILE=/tmp/server.pid
USER bun
EXPOSE 3000
CMD ["bun", "start"]
```

- The `FROM` is the Bun `package.json`'s `packageManager` names: bump the two together.
- The dependencies are a layer of their own, so a change to the code alone reuses it; no scripts
  (`prepare` installs the skills, which a server has no use for). `bun.lock` is committed.
- The server runs as `bun`, not root, and the app's folder is not its to write: the pid file goes
  to `/tmp`. `bun start` hands the platform's `SIGTERM` on, and `run` stops gracefully on it.
- `.dockerignore` keeps `node_modules`, `data/`, `.env*`, `.eta-session*` (a CLI's sign-in) and
  `.git` out of the image.

Working: [create-dzql's template](https://github.com/blueshed/dzql/blob/main/packages/create-dzql/template/Dockerfile), the `Dockerfile` and
`dockerignore` a new app gets; [create-dzql's test](https://github.com/blueshed/dzql/blob/main/packages/create-dzql/tests/create.test.ts) holds its
`FROM` to the app's `packageManager` and starts the app with `bun start`, in production, over a pid
file a container left. No test builds the image (the gate has no Docker); the rest of this page,
the database and the platforms, none: it is configuration outside the app.

## The environment

| Variable | What it does |
| --- | --- |
| `NODE_ENV` | `production` (`bun start` sets it): no hot reload or browser console (delta's `serve`), the session cookie `Secure`, so the site must be HTTPS; the starter's `routes.ts` skips the pid guard; and `openStore` will not start PGlite without a `DATABASE_URL` unless the app says it may |
| `PORT` | where it listens; 3000 without it. Every platform sets it |
| `DATABASE_URL` | the Postgres server, `postgres://<role>:<password>@<host>:5432/<db>?sslmode=verify-full`; without it, PGlite |
| `DATA_PATH` | the data folder (`data/`): PGlite's `pg/` in development, and what `prepare` is given. With `DATABASE_URL` nothing is kept there |
| `ETA_ORIGINS` | other sites whose pages may open the socket, comma-separated origins (`https://www.example.com`); by default only the page's own |
| `LOG_LEVEL` | `error`, `warn`, `info` (the default), `debug` or `silent`: delta's logger |
| `PID_FILE` | where `run` keeps its pid (`bun run stop`): `.server.pid` where it runs, `/tmp/server.pid` in the image |

`--model` (`bun dev`) is what serves the model's page; `bun start` never does. With `dzql/auth-jwt`,
its secret is the app's to read (`JWT_SECRET` in its header's example).

## The database

- **TLS is the URL's**: `sslmode=verify-full` checks the server's certificate against the public
  CAs. A provider with its own CA adds `&sslrootcert=/app/ca.pem` (a file in the image).
  `sslmode=require` is taken as `verify-full` by `pg` 8, with a warning; `no-verify` encrypts
  without checking who answers, for a private network alone.
- **The role is not a superuser, nor `BYPASSRLS`**: either bypasses row-level security, the
  backstop beneath the documents' paths ([rls.md](https://github.com/blueshed/dzql/blob/main/docs/postgres/rls.md)). A platform's first
  user often is one; ask, as that user, and make the app its own:

  ```sql
  SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
  CREATE ROLE app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
  CREATE DATABASE app OWNER app;   -- Postgres 15+: its owner may create in public, so the migrations run
  ```

- **The pool** is `pg`'s, ten connections a process, one of them the listener's for as long as the
  server runs; `openStore` takes no size. Give the server's `max_connections` ten for each
  instance, and room for a migration, `pg_dump` and `psql`.
- **Never through a transaction-mode pooler** (PgBouncer in transaction mode, Supabase's and Neon's
  pooled URLs): the listener's `LISTEN`, its session-level advisory lock, the locks an open and
  the migrations take, and the setting the migrations raise (`dzql.definer`) all need one real
  session. Use a direct URL, or a pooler in session mode.

## Behind a proxy

A platform's edge, nginx or Caddy terminates TLS and passes the request on. The socket (`/ws`) is
refused unless its `Origin` is the `Host` it asked for, so the proxy passes `Host` through and
forwards the upgrade:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 1h;   # a socket stays open
}
```

A proxy that must rewrite `Host` (to an internal name), or a page served from another site, lists
the public origin in `ETA_ORIGINS`. That reaches the socket only: a form route that asks
`refuseOrigin(req)` (the cafe's `/scan`) still needs `Host` passed through. Caddy's
`reverse_proxy 127.0.0.1:3000` does all of this as it is.

## Backups, and what to watch

- **A backup is `pg_dump`**: `pg_dump -Fc "$DATABASE_URL" > app.dump`, and `pg_restore --no-owner
  -d <empty database> app.dump` to bring it back; the app starts on it as it was. The dump holds
  the rows, the ledger (undo and history), `delta_migrations` and the compiled functions.
  `exportTables` is not one: it is the schema's rows as JSON, for moving from PGlite to a server,
  with no ledger and no history. A platform's snapshots serve too; restore one once, to know.
- **Prune the catch-up log**: `_delta_ops_log` gains a row with every write. `pruneOpsLog(pool)`
  (`dzql/postgres`, keeping an hour) clears what is older, and the rows of listeners that are gone;
  run it as a job ([patterns.md](patterns.md#a-background-or-scheduled-job)).
- **Watch** `/health` (the platform's check: the process serves; it asks nothing of the database),
  the log for `listener error` (it reconnects; repeated, the database is going away), the
  connections in use (`SELECT count(*) FROM pg_stat_activity`) against `max_connections`, and the
  size of `_delta_ledger`, which is history and is kept.

## Where to run it

- **Railway**: a Postgres service, and the app's service from its repository, which Railway builds
  from the `Dockerfile`; `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the app (the private
  network's), its health check `/health`. No volume: the data is the database's. Its Postgres user
  is a superuser: make the app's role as above.
- **Fly**: `fly launch` finds the `Dockerfile`; in `fly.toml`, `internal_port = 3000` and a check
  on `/health`. A Fly Postgres cluster attached to the app sets the `DATABASE_URL` secret;
  `fly deploy` ships each change.
- **A VM**: `docker build -t app .`, then `docker run -d --restart unless-stopped -p
  127.0.0.1:3000:3000 -e DATABASE_URL=… app`, behind Caddy or nginx for TLS (above). Without
  Docker, a systemd unit runs `bun start` in the app's folder, its environment in the unit.

Several instances may share the database: each listener is told every write. What an app holds in
memory (a timer, a link printed as it starts) is each instance's own, so start with one.
