#!/usr/bin/env bun
// `dzql`: `serve` and `model` (src/cli/model.ts), and delta's Postgres commands (sql, init,
// migrate, link), in src/postgres/cli.ts.
import { run } from "./model.ts";

if (!(await run(process.argv.slice(2)))) {
  const { main } = await import("../postgres/cli.ts");
  await main(process.argv.slice(2));
  process.exit(0);
}
