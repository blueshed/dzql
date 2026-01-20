import { describe, test, expect } from "bun:test";
import { generateCoreSQL, generateEntitySQL } from "../src/cli/codegen/sql.js";
import { generateSubscribableSQL } from "../src/cli/codegen/subscribable_sql.js";
import { generateNotificationFunction } from "../src/cli/codegen/notification.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities, subscribables } from "../examples/venues.js";

const mockEntityIR = {
  name: "posts",
  table: "posts",
  primaryKey: ["id"],
  columns: [
    { name: "id", type: "serial PRIMARY KEY", isArray: false },
    { name: "title", type: "text NOT NULL", isArray: false }
  ],
  permissions: {
    create: [],
    view: [],
    update: [],
    delete: []
  },
  relationships: {},
  manyToMany: {},
  graphRules: {
    onCreate: [],
    onUpdate: [],
    onDelete: []
  }
};

describe("SQL Code Generation", () => {
  test("generateCoreSQL should produce migration table", () => {
    const sql = generateCoreSQL();
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS dzql_v2");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS dzql_v2.migrations");
  });

  test("generateEntitySQL should produce save function", () => {
    const sql = generateEntitySQL("posts", mockEntityIR);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION dzql_v2.save_posts");
    expect(sql).toContain("AND EXISTS(SELECT 1 FROM posts WHERE"); // Check existence check (composite PK support)
    expect(sql).toContain("UPDATE posts SET"); // Check update branch
    expect(sql).toContain("INSERT INTO posts"); // Check insert branch
  });
});

const mockRawEntity = {
  schema: {
    id: "serial PRIMARY KEY",
    title: "text NOT NULL"
  },
  permissions: {
    create: [],
    view: []
  }
};

describe("Manifest Generation", () => {
  test("should generate allowlist", () => {
    // Create IR first
    const ir = generateIR({
        entities: { posts: mockRawEntity },
        subscribables: {}
    });

    const manifest = generateManifest(ir);

    expect(manifest.version).toBe("2.0.0");
    expect(manifest.functions).toBeDefined();

    // Check allowlist
    expect(manifest.functions["save_posts"]).toBeDefined();
    expect(manifest.functions["get_posts"]).toBeDefined();
    expect(manifest.functions["delete_posts"]).toBeDefined();

    // Check signatures (basic check for now)
    expect(manifest.functions["save_posts"].args).toEqual(["p_user_id", "p_data"]);
  });
});

// Regression tests for bug fixes
describe("Bug Fixes", () => {

  // Bug 1: Subscribable _can_subscribe function generates correct SQL
  // The function should properly fetch the root entity and check permissions
  test("subscribable _can_subscribe should generate correct SQL structure", () => {
    const venuesDomain = { entities, subscribables };
    const ir = generateIR(venuesDomain);

    // Generate SQL for org_dashboard subscribable (has org_id param)
    const sub = ir.subscribables.org_dashboard;
    const sql = generateSubscribableSQL("org_dashboard", sub, ir.entities);

    // Should have proper function structure
    expect(sql).toContain("org_dashboard_can_subscribe");
    expect(sql).toContain("SELECT * INTO v_root");
    expect(sql).toContain("FROM organisations");
    expect(sql).toContain("WHERE id = v_org_id");

    // Should check NOT FOUND
    expect(sql).toContain("IF NOT FOUND THEN");
    expect(sql).toContain("RETURN FALSE");
  });

  // Bug 2: Notification paths not compiled into _notify_users functions
  // The entity notifications were defined in config but never copied to IR,
  // so all _notify_users functions returned empty arrays.
  // Fix: Add notifications to EntityIR interface and copy from config in generateIR.
  test("notifications from entity config should be included in IR", () => {
    const venuesDomain = { entities, subscribables };
    const ir = generateIR(venuesDomain);

    // venues entity has notifications defined
    expect(ir.entities.venues.notifications).toBeDefined();
    expect(ir.entities.venues.notifications?.ownership).toEqual([
      '@org_id->acts_for[org_id=$]{active}.user_id'
    ]);

    // packages entity has multiple notification paths
    expect(ir.entities.packages.notifications).toBeDefined();
    expect(ir.entities.packages.notifications?.ownership).toEqual([
      '@owner_org_id->acts_for[org_id=$]{active}.user_id'
    ]);
    expect(ir.entities.packages.notifications?.commercial).toEqual([
      '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
    ]);
  });

  test("notification function should compile paths into SQL", () => {
    const venuesDomain = { entities, subscribables };
    const ir = generateIR(venuesDomain);

    // Generate notification function for venues
    const sql = generateNotificationFunction("venues", ir.entities.venues);

    // Should NOT be empty - should have the ownership path compiled
    expect(sql).not.toContain("RETURN ARRAY[]::INT[];");

    // Should contain the compiled traversal query
    expect(sql).toContain("acts_for");
    expect(sql).toContain("user_id");
    expect(sql).toContain("org_id");
    expect(sql).toContain("p_data->>'org_id'");
  });

  test("notification function for entity without notifications returns empty array", () => {
    const venuesDomain = { entities, subscribables };
    const ir = generateIR(venuesDomain);

    // users entity has no notifications defined
    const sql = generateNotificationFunction("users", ir.entities.users);

    // Should return empty array
    expect(sql).toContain("RETURN ARRAY[]::INT[];");
    expect(sql).toContain("no paths configured");
  });
});
