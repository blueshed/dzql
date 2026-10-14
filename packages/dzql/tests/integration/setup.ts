import postgres from "postgres";

// `bun test` runs every test file in one process, so a DB name keyed only on
// process.pid is shared across files: each file's CREATE TABLE collides with
// the last, making the suite order-dependent and flaky. Give every
// V2TestDatabase instance (one per file) its own database instead.
let instanceSeq = 0;

export class V2TestDatabase {
  adminSql: any;
  testSql: any;
  dbName: string;
  baseUrl: string;

  constructor() {
    this.dbName = `dzql_test_${process.pid}_${Date.now().toString(36)}_${instanceSeq++}`;
    this.baseUrl = process.env.DATABASE_URL || "postgres://dzql_test:dzql_test@localhost:5433/dzql_test";
  }

  async setup() {
    // 1. Connect as admin to create DB
    const adminUrl = this.baseUrl; // Assumes baseUrl points to accessible DB
    this.adminSql = postgres(adminUrl, { max: 1, onnotice: () => {} });

    try {
      await this.adminSql.unsafe(`DROP DATABASE IF EXISTS ${this.dbName}`);
      await this.adminSql.unsafe(`CREATE DATABASE ${this.dbName}`);
    } catch (e) {
      // Ignore if DB creation fails (might exist)
    }

    // 2. Connect to the fresh Test DB
    const testUrl = this.baseUrl.replace(/\/[^/]*$/, `/${this.dbName}`);
    this.testSql = postgres(testUrl, { onnotice: () => {} });
    
    return this.testSql;
  }

  async applySQL(sqlContent: string) {
    if (!this.testSql) throw new Error("DB not connected");
    await this.testSql.unsafe(sqlContent);
  }

  async teardown() {
    if (this.testSql) await this.testSql.end();
    if (this.adminSql) {
      await this.adminSql.unsafe(`DROP DATABASE IF EXISTS ${this.dbName}`);
      await this.adminSql.end();
    }
  }
}
