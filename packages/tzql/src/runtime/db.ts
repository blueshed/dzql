import postgres from "postgres";

export class Database {
  sql: postgres.Sql;

  constructor(connectionString: string, options: any = {}) {
    this.sql = postgres(connectionString, {
      max: options.max || 10,
      idle_timeout: options.idleTimeout || 20,
      connect_timeout: options.connectTimeout || 10,
      onnotice: () => {}, // Suppress notices
      ...options
    });
  }

  async query(text: string, params: any[] = []) {
    return this.sql.unsafe(text, params);
  }

  async listen(channel: string, callback: (payload: string) => void) {
    console.log(`[DB] Setting up LISTEN on channel: ${channel}`);
    const result = await this.sql.listen(channel, (payload) => {
      console.log(`[DB] LISTEN callback triggered with payload:`, payload);
      callback(payload);
    });
    console.log(`[DB] LISTEN setup complete, result:`, result);
    return result;
  }

  async close() {
    await this.sql.end();
  }
}
