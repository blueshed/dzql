#!/usr/bin/env bun
// `dzql`: the app's own commands (`stories`, `cli`, `model load`, `model built`: src/cli/app.ts),
// `model` (src/cli/model.ts), hjeli's `model site`, `model guards` and `model mcp`
// (src/cli/model-tools.ts), and delta's Postgres commands (sql, init, migrate, link), in
// src/postgres/cli.ts.
import { run as runApp } from "./app.ts";
import { run } from "./model.ts";
import { run as runTools } from "./model-tools.ts";

const argv = process.argv.slice(2);
if (!(await runApp(argv)) && !(await runTools(argv)) && !(await run(argv))) {
  const { main } = await import("../postgres/cli.ts");
  await main(argv);
  process.exit(0);
}
