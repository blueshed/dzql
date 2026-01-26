import { describe, test, expect } from "bun:test";
import { parsePath, compilePathToExists, compilePathToSelect, validatePath } from "../src/cli/compiler/paths.js";
import { compilePermission } from "../src/cli/compiler/permissions.js";

describe("Path Expression Parser", () => {
  describe("Literal values", () => {
    test("TRUE literal", () => {
      const parsed = parsePath("TRUE");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(0);
    });

    test("FALSE literal", () => {
      const parsed = parsePath("FALSE");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(0);
    });

    test("lowercase true", () => {
      const parsed = parsePath("true");
      expect(parsed.isValid).toBe(true);
    });
  });

  describe("Simple field references", () => {
    test("@author_id", () => {
      const parsed = parsePath("@author_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(1);
      expect(parsed.hops[0].type).toBe("field");
      expect(parsed.hops[0].field).toBe("author_id");
      expect(parsed.startField).toBe("author_id");
    });

    test("@user_id", () => {
      const parsed = parsePath("@user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.startField).toBe("user_id");
    });
  });

  describe("Explicit comparison", () => {
    test("@author_id == @user_id", () => {
      const parsed = parsePath("@author_id == @user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(1);
      expect(parsed.startField).toBe("author_id");
    });

    test("@created_by==@user_id (no spaces)", () => {
      const parsed = parsePath("@created_by==@user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.startField).toBe("created_by");
    });
  });

  describe("Single-hop traversal", () => {
    test("@org_id->acts_for[org_id=$]{active}.user_id", () => {
      const parsed = parsePath("@org_id->acts_for[org_id=$]{active}.user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(2);
      expect(parsed.startField).toBe("org_id");

      // First hop is field reference
      expect(parsed.hops[0].type).toBe("field");
      expect(parsed.hops[0].field).toBe("org_id");

      // Second hop is final lookup
      expect(parsed.hops[1].type).toBe("final");
      expect(parsed.hops[1].table).toBe("acts_for");
      expect(parsed.hops[1].filter?.field).toBe("org_id");
      expect(parsed.hops[1].filter?.value).toBe("$");
      expect(parsed.hops[1].conditions).toHaveLength(1);
      expect(parsed.hops[1].conditions![0].type).toBe("boolean");
      expect(parsed.hops[1].conditions![0].field).toBe("active");
      expect(parsed.hops[1].outputField).toBe("user_id");
    });

    test("@org_id->user_orgs[org_id=$].user_id (no condition)", () => {
      const parsed = parsePath("@org_id->user_orgs[org_id=$].user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops[1].conditions).toHaveLength(0);
    });
  });

  describe("Multi-hop traversal", () => {
    test("@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id", () => {
      const parsed = parsePath("@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id");
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(3);
      expect(parsed.startField).toBe("venue_id");

      // First: field reference
      expect(parsed.hops[0].type).toBe("field");

      // Second: intermediate table lookup
      expect(parsed.hops[1].type).toBe("table");
      expect(parsed.hops[1].table).toBe("venues");
      expect(parsed.hops[1].outputField).toBe("org_id");

      // Third: final lookup
      expect(parsed.hops[2].type).toBe("final");
      expect(parsed.hops[2].table).toBe("acts_for");
    });

    test("Deep traversal (4 hops)", () => {
      const path = "@package_id->packages.occasion_id->occasions.venue_id->venues.org_id->user_orgs[org_id=$].user_id";
      const parsed = parsePath(path);
      expect(parsed.isValid).toBe(true);
      expect(parsed.hops).toHaveLength(5);

      expect(parsed.hops[0].field).toBe("package_id");
      expect(parsed.hops[1].table).toBe("packages");
      expect(parsed.hops[1].outputField).toBe("occasion_id");
      expect(parsed.hops[2].table).toBe("occasions");
      expect(parsed.hops[2].outputField).toBe("venue_id");
      expect(parsed.hops[3].table).toBe("venues");
      expect(parsed.hops[3].outputField).toBe("org_id");
      expect(parsed.hops[4].table).toBe("user_orgs");
    });
  });

  describe("Table-first patterns", () => {
    test("contractor_rights[package_id=@package_id]{active}.contractor_org_id->user_orgs[org_id=$].user_id", () => {
      const path = "contractor_rights[package_id=@package_id]{active}.contractor_org_id->user_orgs[org_id=$].user_id";
      const parsed = parsePath(path);
      expect(parsed.isValid).toBe(true);
      expect(parsed.tableFirst).toBe(true);
      expect(parsed.hops).toHaveLength(2);

      // First: table-first lookup
      expect(parsed.hops[0].type).toBe("table");
      expect(parsed.hops[0].table).toBe("contractor_rights");
      expect(parsed.hops[0].filter?.field).toBe("package_id");
      expect(parsed.hops[0].filter?.value).toBe("@package_id");
      expect(parsed.hops[0].conditions![0].field).toBe("active");
      expect(parsed.hops[0].outputField).toBe("contractor_org_id");

      // Second: final lookup
      expect(parsed.hops[1].type).toBe("final");
      expect(parsed.hops[1].table).toBe("user_orgs");
    });
  });

  describe("Condition parsing", () => {
    test("{active} - boolean condition", () => {
      const parsed = parsePath("@org_id->acts_for[org_id=$]{active}.user_id");
      const cond = parsed.hops[1].conditions![0];
      expect(cond.type).toBe("boolean");
      expect(cond.field).toBe("active");
    });

    test("{role=admin} - equality condition", () => {
      const parsed = parsePath("@org_id->acts_for[org_id=$]{role=admin}.user_id");
      const cond = parsed.hops[1].conditions![0];
      expect(cond.type).toBe("equality");
      expect(cond.field).toBe("role");
      expect(cond.value).toBe("admin");
    });

    test("{active,role=owner} - multiple conditions", () => {
      const parsed = parsePath("@org_id->acts_for[org_id=$]{active,role=owner}.user_id");
      expect(parsed.hops[1].conditions).toHaveLength(2);
      expect(parsed.hops[1].conditions![0].type).toBe("boolean");
      expect(parsed.hops[1].conditions![1].type).toBe("equality");
      expect(parsed.hops[1].conditions![1].value).toBe("owner");
    });

    test("{valid_to=NULL} - NULL equality", () => {
      const parsed = parsePath("@org_id->memberships[org_id=$]{valid_to=NULL}.user_id");
      const cond = parsed.hops[1].conditions![0];
      expect(cond.type).toBe("equality");
      expect(cond.field).toBe("valid_to");
      expect(cond.value).toBe("NULL");
    });
  });

  describe("Invalid paths", () => {
    test("empty string", () => {
      const parsed = parsePath("");
      expect(parsed.isValid).toBe(false);
    });

    test("malformed traversal", () => {
      const parsed = parsePath("@org_id->");
      expect(parsed.isValid).toBe(false);
    });

    test("missing output field", () => {
      const parsed = parsePath("@org_id->acts_for[org_id=$]{active}");
      expect(parsed.isValid).toBe(false);
    });
  });
});

describe("Permission Compilation (EXISTS)", () => {
  test("TRUE literal compiles to TRUE", () => {
    expect(compilePermission("test", "TRUE", null)).toBe("TRUE");
  });

  test("FALSE literal compiles to FALSE", () => {
    expect(compilePermission("test", "FALSE", null)).toBe("FALSE");
  });

  test("Simple field compiles to equality check", () => {
    const sql = compilePermission("posts", "@author_id", null);
    expect(sql).toBe("(p_data->>'author_id')::int = p_user_id");
  });

  test("Explicit comparison compiles correctly", () => {
    const sql = compilePermission("posts", "@created_by == @user_id", null);
    expect(sql).toBe("(p_data->>'created_by')::int = p_user_id");
  });

  test("Single-hop traversal compiles to EXISTS", () => {
    const sql = compilePermission("venues", "@org_id->acts_for[org_id=$]{active}.user_id", null);
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("acts_for");
    expect(sql).toContain("org_id = (p_data->>'org_id')::int");
    expect(sql).toContain("active = true");
    expect(sql).toContain("user_id = p_user_id");
  });

  test("Multi-hop traversal compiles with nested subqueries", () => {
    const sql = compilePermission("sites", "@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id", null);
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("SELECT org_id FROM venues");
    expect(sql).toContain("acts_for");
  });

  test("Table-first pattern compiles correctly", () => {
    const sql = compilePermission("packages", "contractor_rights[package_id=@package_id]{active}.contractor_org_id->user_orgs[org_id=$].user_id", null);
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("contractor_rights");
    expect(sql).toContain("user_orgs");
  });

  test("Works with table dataVar (non-JSONB)", () => {
    const sql = compilePermission("venues", "@org_id->acts_for[org_id=$]{active}.user_id", null, "venues");
    expect(sql).toContain("venues.org_id");
    expect(sql).not.toContain("p_data");
  });
});

describe("Notification Compilation (SELECT)", () => {
  test("Simple field compiles to SELECT", () => {
    const parsed = parsePath("@author_id");
    const sql = compilePathToSelect(parsed, "p_data");
    expect(sql).toContain("SELECT");
    expect(sql).toContain("author_id");
  });

  test("Single-hop traversal compiles to SELECT user_id", () => {
    const parsed = parsePath("@org_id->acts_for[org_id=$]{active}.user_id");
    const sql = compilePathToSelect(parsed, "p_data");
    expect(sql).toContain("SELECT acts_for.user_id FROM acts_for");
    expect(sql).toContain("org_id = (p_data->>'org_id')::int");
    expect(sql).toContain("active = true");
  });

  test("Multi-hop traversal compiles with nested subqueries", () => {
    const parsed = parsePath("@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id");
    const sql = compilePathToSelect(parsed, "p_data");
    expect(sql).toContain("SELECT acts_for.user_id FROM acts_for");
    expect(sql).toContain("SELECT org_id FROM venues");
  });

  test("Deep traversal (4 hops) compiles correctly", () => {
    const path = "@package_id->packages.occasion_id->occasions.venue_id->venues.org_id->user_orgs[org_id=$].user_id";
    const parsed = parsePath(path);
    const sql = compilePathToSelect(parsed, "p_data");

    expect(sql).toContain("SELECT user_orgs.user_id FROM user_orgs");
    expect(sql).toContain("SELECT occasion_id FROM packages");
    expect(sql).toContain("SELECT venue_id FROM occasions");
    expect(sql).toContain("SELECT org_id FROM venues");
  });

  test("Table-first pattern compiles correctly", () => {
    const path = "contractor_rights[package_id=@package_id]{active}.contractor_org_id->user_orgs[org_id=$].user_id";
    const parsed = parsePath(path);
    const sql = compilePathToSelect(parsed, "p_data");

    expect(sql).toContain("SELECT user_orgs.user_id FROM user_orgs");
    expect(sql).toContain("contractor_rights");
  });
});

describe("Path Validation", () => {
  test("Valid simple path", () => {
    const result = validatePath("@author_id");
    expect(result.valid).toBe(true);
  });

  test("Valid traversal path", () => {
    const result = validatePath("@org_id->acts_for[org_id=$]{active}.user_id");
    expect(result.valid).toBe(true);
  });

  test("Invalid path returns error", () => {
    const result = validatePath("invalid path syntax");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("Parity between Permission and Notification compilation", () => {
  const testPaths = [
    "@author_id",
    "@org_id->acts_for[org_id=$]{active}.user_id",
    "@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id",
    "@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id",
  ];

  for (const path of testPaths) {
    test(`Both compile successfully: ${path.slice(0, 50)}...`, () => {
      const parsed = parsePath(path);
      expect(parsed.isValid).toBe(true);

      const existsSql = compilePathToExists(parsed, "p_data");
      const selectSql = compilePathToSelect(parsed, "p_data");

      // Both should produce non-error SQL
      expect(existsSql).not.toBe("FALSE");
      expect(selectSql).not.toContain("WHERE FALSE");
    });
  }
});
