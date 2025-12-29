import postgres from "postgres";

export class V2TestDatabase {
  adminSql: any;
  testSql: any;
  dbName: string;
  baseUrl: string;

  constructor() {
    this.dbName = `tzql_test_${process.pid}`;
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
