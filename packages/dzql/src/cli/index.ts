#!/usr/bin/env bun
// `dzql`: `serve` and `model` (src/cli/model.ts), hjeli's `model site`, `model guards` and
// `model mcp` (src/cli/model-tools.ts), and delta's Postgres commands (sql, init, migrate, link),
// in src/postgres/cli.ts.
import { run } from "./model.ts";
import { run as runTools } from "./model-tools.ts";

if (!(await runTools(process.argv.slice(2))) && !(await run(process.argv.slice(2)))) {
  const { main } = await import("../postgres/cli.ts");
  await main(process.argv.slice(2));
  process.exit(0);
}
