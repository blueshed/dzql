/**
 * The schema is the contract (reference/migrations.md): `schemaContractCases`
 * from ./testing, asked of SQLite (dzql asks the same of Postgres). The JSON
 * file is not asked: it runs no migrations and no SQL of an app's, and one
 * process owns its file, so there is no second version beside the first.
 */
import { afterAll } from "bun:test";
import { schemaContractCases } from "@blueshed/delta/testing";
import { setLogLevel } from "../src/server/logger";
import { removeUpgradeDirs, sqliteUpgrades } from "./helpers/case-backends";

setLogLevel("silent");
afterAll(removeUpgradeDirs);

schemaContractCases("sqlite", sqliteUpgrades);
