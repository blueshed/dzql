#!/usr/bin/env node
/**
 * Initialize test database
 * Run this script before running tests to set up the database
 */

import postgres from "postgres";
import { setupTestDatabase } from "./db-setup.js";

async function main() {
  console.log("🔧 Initializing test database...");

  // First connect to postgres database to create test database
  const adminConnectionString =
    process.env.DATABASE_URL?.replace(/\/[^/]+$/, "/postgres") ||
    "postgres://dzql_test:dzql_test@localhost:5433/postgres";

  const adminSql = postgres(adminConnectionString, {
    max: 1,
    onnotice: () => {}, // Suppress NOTICE messages
  });

  try {
    // Drop and recreate test database
    console.log("📦 Creating dzql_test database...");
    await adminSql.unsafe(`DROP DATABASE IF EXISTS dzql_test`);
    await adminSql.unsafe(`CREATE DATABASE dzql_test`);
    console.log("✅ Database created");
  } catch (error) {
    console.error("❌ Error creating database:", error.message);
    throw error;
  } finally {
    await adminSql.end();
  }

  // Now set up the schema and migrations
  const sql = await setupTestDatabase();
  await sql.end();

  console.log("✅ Test database initialized successfully!");
  console.log("");
  console.log("You can now run tests with: bun test");
}

main().catch((error) => {
  console.error("❌ Failed to initialize test database:", error);
  process.exit(1);
});
