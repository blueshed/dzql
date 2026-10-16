/**
 * Test setup helpers for delta's Postgres tests, as dzql runs them -- a pg Pool
 * against the suite's database (DATABASE_URL: compose.yml's, or CI's service), apply framework SQL files, and clean up between cases. The helpers
 * that need no Postgres (mockClient, sendAndAwait, waitFor) are the package's
 * own `@blueshed/delta/testing` (src/testing.ts).
 *
 * The compose service listens on localhost:5433 (so it won't fight with any
 * local Postgres on :5432). Override with DELTA_TEST_PG_URL if needed.
 */
import { Pool } from "pg";
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { applyFramework as applyFrameworkFromPkg, applySql, defineDoc, defineSchema, generateSql } from "../../src/postgres";
import { applyAuthJwtSchema } from "../../src/postgres/auth-jwt";

export const PG_URL =
  process.env.DELTA_TEST_PG_URL ??
  process.env.DATABASE_URL ??
  "postgres://dzql_test:dzql_test@localhost:5433/dzql_test";

export async function newPool(): Promise<Pool> {
  return new Pool({ connectionString: PG_URL, max: 8 });
}

/** Apply the delta framework SQL (001*) in alphabetical order. */
export async function applyFramework(pool: Pool): Promise<void> {
  await applyFrameworkFromPkg(pool);
}

/** Apply the auth-jwt reference schema (users + login/register). */
export async function applyAuthJwt(pool: Pool): Promise<void> {
  await applyAuthJwtSchema(pool);
}

/**
 * Apply definitions, as an app applies them: one `generateSql` over the tables and documents, every
 * document compiled. A file applies its whole set once: a later `generateSql` with fewer documents
 * would leave the rest uncompiled.
 */
export async function applyDefined(pool: Pool, tables: Record<string, unknown>, docs: DocDef[]): Promise<{ schema: Schema; docs: DocDef[] }> {
  const schema = defineSchema(tables as Parameters<typeof defineSchema>[0]);
  await applySql(pool, generateSql(schema, docs));
  return { schema, docs };
}

/** The items fixture as definitions: one flat `items` collection, and `items:`, the list of them. */
export const itemsTables = { items: { columns: { name: "text", value: { type: "integer", default: 0 } }, temporal: false } } as const;
export const itemsDoc = defineDoc("items:", { root: "items", include: [] });

/** The items fixture, and whatever tables and documents a test file adds (`more`). */
export async function applyItems(pool: Pool, more: { tables?: Record<string, unknown>; docs?: DocDef[] } = {}): Promise<{ schema: Schema; docs: DocDef[] }> {
  return applyDefined(pool, { ...itemsTables, ...(more.tables ?? {}) }, [itemsDoc, ...(more.docs ?? [])]);
}

/** The items fixture alone (as postgres.test.ts and the others had it). */
export async function applyItemsFixture(pool: Pool): Promise<void> {
  await applyItems(pool);
}

/** Worlds and the sites in them, with a place each: `world:<id>` is the world and its sites. */
export const sitesTables = {
  worlds: { columns: { label: "text" }, temporal: false },
  sites: { parent: { collection: "worlds", fk: "world_id" }, columns: { name: "text", lat: "real", lng: "real" }, temporal: false },
} as const;
export const worldDoc = defineDoc("world:", { root: "worlds", include: ["sites"] });

/** Customers, their brands, and the brands' artworks (an FK chain): `customer:<id>` is one customer's all. */
export const customersTables = {
  customers: { columns: { name: "text" }, temporal: false },
  brands: { parent: "customers", columns: { name: "text" }, temporal: false },
  artworks: { parent: { collection: "brands", fk: "brand_id" }, columns: { title: "text" }, temporal: false },
} as const;
export const customerDoc = defineDoc("customer:", { root: "customers", include: ["brands", "artworks"] });

/**
 * Reset all delta/test state so tests can run independently. Truncates the
 * framework's bookkeeping tables and the test-data tables. Cheap compared
 * to tearing down the container.
 */
export async function resetState(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('items') IS NOT NULL THEN
        EXECUTE 'TRUNCATE items RESTART IDENTITY CASCADE';
        -- delta's serial is not owned by the table (RESTART IDENTITY leaves it): each test names ids anew (#71)
        EXECUTE 'ALTER SEQUENCE seq_items RESTART';
      END IF;
      IF to_regclass('users') IS NOT NULL THEN
        EXECUTE 'TRUNCATE users RESTART IDENTITY CASCADE';
      END IF;
      IF to_regclass('_delta_versions') IS NOT NULL THEN
        EXECUTE 'TRUNCATE _delta_versions';
      END IF;
      IF to_regclass('_delta_ops_log') IS NOT NULL THEN
        EXECUTE 'TRUNCATE _delta_ops_log RESTART IDENTITY';
      END IF;
      IF to_regclass('_delta_ledger') IS NOT NULL THEN
        EXECUTE 'TRUNCATE _delta_ledger RESTART IDENTITY';
      END IF;
    END $$;
  `);
}
