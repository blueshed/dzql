/**
 * The schema is the contract (reference/migrations.md): delta's `schemaContractCases`
 * (`@blueshed/delta/testing`), asked of Postgres in process (PGlite). delta asks the same of SQLite.
 */
import { afterAll } from "bun:test";
import { schemaContractCases } from "@blueshed/delta/testing";
import { setLogLevel } from "@blueshed/delta/logger";
import { endUpgrades, pgliteUpgrades } from "./helpers/upgrades";

setLogLevel("silent");
afterAll(endUpgrades);

schemaContractCases("pglite", pgliteUpgrades);
