#!/usr/bin/env bun
// `dzql`: delta's Postgres commands (sql, init, migrate, link), in src/postgres/cli.ts.
import { main } from "../postgres/cli.ts";

await main(process.argv.slice(2));
process.exit(0);
