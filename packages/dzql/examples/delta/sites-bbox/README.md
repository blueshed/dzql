# sites-bbox, on Postgres

delta's example, [packages/delta/examples/sites-bbox](../../../../delta/examples/sites-bbox/README.md):
a world of sites, and a box (`sites-in-bbox:<minLng>,<minLat>,<maxLng>,<maxLat>`) that holds the
sites inside it and is told what changes for it. Its schema and documents are delta's
(`schema.ts` there); here the rows are in Postgres, so a box open on one server is told of sites
written through another.

From `packages/dzql`: `bun run test:setup` starts the compose Postgres on 5433 (`DATABASE_URL` names
another).

```sh
bun run test:setup
PORT=3100 bun examples/delta/sites-bbox/server-pg.ts
```

It makes its tables and a world, and prints the world's name (`world:1` in a fresh database).
Run it twice on the same database, on two ports, and a box open on one is told of sites written
through the other. delta's README has the steps to try; `tests/delta-pg/postgres-examples.test.ts`
runs them here, with delta's own story (`packages/delta/tests/helpers/examples.ts`).
