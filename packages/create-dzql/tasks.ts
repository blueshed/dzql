import { Context } from "invoket/context";
import { DzqlNamespace } from "dzql/namespace";

/** Database management tasks */
class DbNamespace {
  /** Start the PostgreSQL container */
  async up(c: Context) {
    await c.run("docker compose up -d", { echo: true });
  }

  /** Stop and remove the PostgreSQL container (deletes data) */
  async down(c: Context) {
    await c.run("docker compose down -v", { echo: true });
  }

  /** Recompile and rebuild the database from scratch */
  async rebuild(c: Context) {
    console.log("Compiling domain...");
    await c.run("bunx dzql domain.ts -o generated", { echo: true });
    console.log("Stopping database...");
    await c.run("docker compose down -v", { echo: true });
    console.log("Starting database with fresh schema...");
    await c.run("docker compose up -d", { echo: true });
    console.log("Database rebuilt successfully!");
  }

  /** Show database logs */
  async logs(c: Context) {
    await c.run("docker compose logs -f postgres", { echo: true });
  }

  /** Connect to PostgreSQL with psql */
  async psql(c: Context) {
    await c.run("docker compose exec postgres psql -U postgres -d {{name}}", { echo: true });
  }
}

/**
 * Task runner for {{name}}
 *
 * Usage:
 *   bunx invt --list              # List all available tasks
 *   bunx invt dzql:entities       # List all entities
 *   bunx invt dzql:functions      # List all manifest functions
 *   bunx invt dzql:search users   # Search users
 *   bunx invt db:rebuild          # Rebuild database
 *
 * After `bun link invoket`:
 *   invt --list
 *   invt dzql:entities
 */
export class Tasks {
  /** DZQL namespace for database operations */
  dzql = new DzqlNamespace();

  /** Database management namespace */
  db = new DbNamespace();

  /** Compile the domain and regenerate SQL/client code */
  async compile(c: Context) {
    await c.run("bunx dzql domain.ts -o generated", { echo: true });
  }

  /** Start the development servers */
  async dev(c: Context) {
    await c.run('concurrently -n server,client -c blue,green "bun run --filter server dev" "bun run --filter client dev"', { echo: true });
  }

  /** Start only the backend server */
  async server(c: Context) {
    await c.run("bun run --filter server dev", { echo: true });
  }

  /** Start only the frontend client */
  async client(c: Context) {
    await c.run("bun run --filter client dev", { echo: true });
  }
}
