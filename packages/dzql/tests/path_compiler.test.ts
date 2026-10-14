import { describe, test, expect } from "bun:test";
import { compilePermission, compileRuleList } from "../src/cli/compiler/permissions.js";
import { parsePath, compilePathToExists, compilePathToSelect, PathCompileError } from "../src/cli/compiler/paths.js";

// Rules below are taken from blueshed/modeling-dzql (tests/fixtures/modeling-dzql.domain.ts).
const PROMOTER = "@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id";
const PROMOTER_OWNER = "@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$,role=owner].user_id";
const ORG_OWNER = "@id->user_orgs[org_id=$,role=owner].user_id";

describe("filtered middle hops", () => {
  test("compile to nested EXISTS, never FALSE", () => {
    const sql = compilePermission("packages", PROMOTER, null, "p_data");
    expect(sql).toBe(
      "EXISTS (SELECT 1 FROM occasion_promoters WHERE occasion_promoters.occasion_id = (p_data->>'occasion_id')::int" +
      " AND EXISTS (SELECT 1 FROM user_orgs WHERE user_orgs.org_id = occasion_promoters.promoter_id" +
      " AND user_orgs.user_id = p_user_id))"
    );
  });

  test("an unfiltered hop after a filtered one joins on id", () => {
    const sql = compilePermission(
      "package_offers",
      "@package_id->packages.occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id",
      null,
      "p_data"
    );
    expect(sql).toBe(
      "EXISTS (SELECT 1 FROM packages WHERE packages.id = (p_data->>'package_id')::int" +
      " AND EXISTS (SELECT 1 FROM occasion_promoters WHERE occasion_promoters.occasion_id = packages.occasion_id" +
      " AND EXISTS (SELECT 1 FROM user_orgs WHERE user_orgs.org_id = occasion_promoters.promoter_id" +
      " AND user_orgs.user_id = p_user_id)))"
    );
  });

  test("notification SELECT follows the same hops", () => {
    const sql = compilePathToSelect(parsePath(PROMOTER), "p_data");
    expect(sql).toContain("occasion_promoters.occasion_id = (p_data->>'occasion_id')::int");
    expect(sql).toContain("user_orgs.org_id = occasion_promoters.promoter_id");
    expect(sql).toStartWith("SELECT user_orgs.user_id FROM");
  });
});

describe("several conditions inside [ ]", () => {
  test("[org_id=$,role=owner] keeps role=owner", () => {
    const sql = compilePermission("organisations", ORG_OWNER, null, "p_data");
    expect(sql).toBe(
      "EXISTS (SELECT 1 FROM user_orgs WHERE user_orgs.org_id = (p_data->>'id')::int" +
      " AND user_orgs.role = 'owner' AND user_orgs.user_id = p_user_id)"
    );
  });

  test("on the last hop of a filtered chain", () => {
    const sql = compilePermission("packages", PROMOTER_OWNER, null, "p_data");
    expect(sql).toContain("user_orgs.role = 'owner'");
    expect(sql).toContain("occasion_promoters.occasion_id = (p_data->>'occasion_id')::int");
  });

  test("a filter may compare with a field of the row being checked", () => {
    const sql = compilePermission("posts", "@org_id->acts_for[org_id=$,team_id=@team_id].user_id", null, "p_data");
    expect(sql).toContain("acts_for.team_id = (p_data->>'team_id')::int");
  });

  test("quoted values are escaped", () => {
    const sql = compilePermission("posts", "@org_id->acts_for[org_id=$,role='o''brien'].user_id", null, "p_data");
    expect(sql).toContain("acts_for.role = 'o''brien'");
  });
});

describe("the row being checked is never shadowed by a hop on the same table", () => {
  test("occasion_promoters checked through occasion_promoters", () => {
    const rule = "@occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id";
    const sql = compilePermission("occasion_promoters", rule, null, "occasion_promoters");
    expect(sql).toContain("FROM occasion_promoters occasion_promoters_1 WHERE occasion_promoters_1.occasion_id = occasion_promoters.occasion_id");
    expect(sql).toContain("user_orgs.org_id = occasion_promoters_1.promoter_id");
  });

  test("a table that appears twice in one path gets two aliases", () => {
    const sql = compilePermission("tasks", "@parent_id->tasks.parent_id->tasks.owner_id->users.id", null, "p_data");
    expect(sql).toContain("FROM tasks WHERE tasks.id = (p_data->>'parent_id')::int");
    expect(sql).toContain("FROM tasks tasks_1 WHERE tasks_1.id = tasks.parent_id");
    expect(sql).toContain("users.id = tasks_1.owner_id");
  });
});

describe("row sources", () => {
  test("a record variable with a field map (subscribe root)", () => {
    const sql = compilePathToExists(parsePath("@venue_id->venues.org_id->user_orgs[org_id=$].user_id"),
      { kind: "row", name: "v_root", fieldMap: { venue_id: "id" } }, "p_user_id");
    expect(sql).toContain("venues.id = v_root.id");
    expect(sql).not.toContain("->>");
  });

  test("a stored-row JSONB variable", () => {
    const sql = compilePermission("packages", PROMOTER, null, "v_old_data");
    expect(sql).toContain("(v_old_data->>'occasion_id')::int");
  });
});

describe("literals and rule lists", () => {
  test("AUTHENTICATED means any signed-in user", () => {
    expect(compilePermission("posts", "AUTHENTICATED", null)).toBe("p_user_id IS NOT NULL");
  });

  test("an empty list denies everyone", () => {
    expect(compileRuleList("posts", [], "p_data")).toBe("FALSE");
  });

  test("every rule in a list is enforced, OR'd", () => {
    const sql = compileRuleList("venue_series_applications", [
      "@series_id->series.authority_org_id->user_orgs[org_id=$].user_id",
      "@venue_id->venues.org_id->user_orgs[org_id=$].user_id",
    ], "p_data");
    expect(sql).toStartWith("(");
    expect(sql).toContain(") OR (");
    expect(sql).toContain("series.id = (p_data->>'series_id')::int");
    expect(sql).toContain("venues.id = (p_data->>'venue_id')::int");
  });
});

describe("a path that can't be compiled is an error, never FALSE", () => {
  const bad: Array<[string, RegExp]> = [
    ["invalid path syntax", /Unrecognized/],
    ["@org_id->", /hop/i],
    ["@org_id->acts_for[org_id=$]{active}", /final hop/i],
    ["@a->t[x=$,y=$].id->user_orgs[org_id=$].user_id", /more than one \$/],
    ["@a->t[x=1].id->user_orgs[org_id=$].user_id", /must join on \$/],
    ["t[x=$].id->user_orgs[org_id=$].user_id", /\$ .*first hop/],
    ["@a->t[x=$,y].id->user_orgs[org_id=$].user_id", /filter/i],
    ["@a->acts_for[org_id=$]{valid_from<=now();drop table x}.user_id", /condition/i],
  ];
  for (const [rule, why] of bad) {
    test(rule, () => {
      let err: any;
      try { compilePermission("posts", rule, null, "p_data"); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(PathCompileError);
      expect(err.message).toMatch(why);
      expect(err.message).toContain(rule);
    });
  }

  test("parsePath still reports invalid paths without throwing", () => {
    const parsed = parsePath("@a->t[x=$,y=$].id->user_orgs[org_id=$].user_id");
    expect(parsed.isValid).toBe(false);
  });
});
