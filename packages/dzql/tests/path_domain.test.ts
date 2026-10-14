import { describe, test, expect } from "bun:test";
import { compileDomain, DomainValidationError } from "../src/cli/compile.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { generateEntitySQL } from "../src/cli/codegen/sql.js";
import { generateSubscribableSQL } from "../src/cli/codegen/subscribable_sql.js";
import * as fixture from "./fixtures/modeling-dzql.domain.js";
import { patchedModelingDomain, MISSING_COLUMNS } from "./fixtures/modeling-dzql.patched.js";
import { compilePermission } from "../src/cli/compiler/permissions.js";

const quiet = <T>(fn: () => T): T => {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
};

function buildErrors(domain: any): string[] {
  try {
    quiet(() => compileDomain(domain));
  } catch (e) {
    if (e instanceof DomainValidationError) return e.errors;
    throw e;
  }
  return [];
}

const base = () => ({
  entities: {
    users: { schema: { id: "serial PRIMARY KEY", email: "text" }, permissions: { view: ["@id"] } },
    orgs: { schema: { id: "serial PRIMARY KEY", name: "text" }, permissions: { view: ["@id->members[org_id=$].user_id"] } },
    members: {
      schema: { id: "serial PRIMARY KEY", org_id: "int REFERENCES orgs(id)", user_id: "int REFERENCES users(id)", role: "text" },
      permissions: { view: ["@org_id->members[org_id=$].user_id"] },
    },
  } as Record<string, any>,
  subscribables: {} as Record<string, any>,
});

describe("paths are checked against the domain at build time", () => {
  test("a valid domain builds", () => {
    expect(buildErrors(base())).toEqual([]);
  });

  test("an unknown table is a build error naming entity, action and rule", () => {
    const d = base();
    d.entities.orgs.permissions.update = ["@id->acts_for[org_id=$].user_id"];
    const errors = buildErrors(d);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("orgs.permissions.update");
    expect(errors[0]).toContain("@id->acts_for[org_id=$].user_id");
    expect(errors[0]).toMatch(/unknown table 'acts_for'/i);
  });

  test("an unknown column is a build error", () => {
    const d = base();
    d.entities.orgs.permissions.update = ["@org_id->members[org_id=$].user_id"];
    d.entities.members.permissions.update = ["@org_id->members[org_id=$,rank=owner].user_id"];
    const errors = buildErrors(d).join("\n");
    expect(errors).toMatch(/orgs\.permissions\.update.*no column 'org_id' on orgs/);
    expect(errors).toMatch(/members\.permissions\.update.*no column 'rank' on members/);
  });

  test("a start field that isn't an integer key is a build error (it would fail the ::int cast at runtime)", () => {
    const d = base();
    d.entities.users.notifications = { me: ["@email"] };
    expect(buildErrors(d).join("\n")).toMatch(/users\.notifications\.me.*'email' is text, not an integer key/);
  });

  test("an unparseable path is a build error", () => {
    const d = base();
    d.entities.orgs.permissions.delete = ["@id->members[org_id=$,role=owner"];
    expect(buildErrors(d).join("\n")).toContain("orgs.permissions.delete");
  });

  test("canSubscribe paths are checked against the root entity", () => {
    const d = base();
    d.subscribables.org_view = {
      params: { org_id: "int" }, root: { entity: "orgs", key: "org_id" },
      canSubscribe: ["@org_id->members[org_id=$].nobody"],
    };
    expect(buildErrors(d).join("\n")).toMatch(/org_view\.canSubscribe.*no column 'nobody' on members/);
  });

  test("a list subscribable can only take literal rules: there is no row to follow a path from", () => {
    const d = base();
    d.subscribables.all_orgs = { params: {}, root: { entity: "orgs" }, canSubscribe: ["@id->members[org_id=$].user_id"] };
    expect(buildErrors(d).join("\n")).toMatch(/all_orgs\.canSubscribe.*list subscribable/);
  });
});

describe("codegen never emits a fallback", () => {
  test("generating SQL for an unparseable rule throws instead of compiling to FALSE", () => {
    const ir = generateIR({
      entities: { posts: { schema: { id: "serial PRIMARY KEY", org_id: "int" }, permissions: { update: ["@org_id->"] } } },
      subscribables: {},
    } as any);
    expect(() => generateEntitySQL("posts", ir.entities.posts)).toThrow(/@org_id->/);
  });

  test("an unparseable canSubscribe path throws instead of falling back to signed-in users", () => {
    const domain: any = {
      entities: { orgs: { schema: { id: "serial PRIMARY KEY" } } },
      subscribables: { org_view: { params: { org_id: "int" }, root: { entity: "orgs", key: "org_id" }, canSubscribe: ["not a path"] } },
    };
    const ir = generateIR(domain);
    expect(() => generateSubscribableSQL("org_view", ir.subscribables.org_view as any, ir.entities)).toThrow(/not a path/);
  });

  test("canSubscribe: [] denies everyone", () => {
    const domain: any = {
      entities: { orgs: { schema: { id: "serial PRIMARY KEY" } } },
      subscribables: {
        org_view: { params: { org_id: "int" }, root: { entity: "orgs", key: "org_id" }, canSubscribe: [] },
        all_orgs: { params: {}, root: { entity: "orgs" }, canSubscribe: [] },
      },
    };
    const ir = generateIR(domain);
    for (const name of ["org_view", "all_orgs"]) {
      const sql = generateSubscribableSQL(name, ir.subscribables[name] as any, ir.entities);
      const fn = sql.slice(sql.indexOf(`${name}_can_subscribe`), sql.indexOf("$$;", sql.indexOf(`${name}_can_subscribe`)));
      expect(fn).not.toContain("RETURN TRUE");
      expect(fn).not.toContain("IS NOT NULL");
      expect(fn).toMatch(/RETURN FALSE|RETURN \(\s*FALSE\s*\)/);
    }
  });
});

describe("modeling-dzql: every one of its rules", () => {
  const rules: Array<{ where: string; rule: string }> = [];
  for (const [table, e] of Object.entries<any>(fixture.entities)) {
    for (const [action, list] of Object.entries<any>(e.permissions ?? {})) {
      for (const rule of list) rules.push({ where: `${table}.permissions.${action}`, rule });
    }
  }

  test("there are 204 entity permission rules", () => {
    expect(rules).toHaveLength(204);
  });

  test("is rejected at build time, naming exactly the columns its rules assume and its schema lacks", () => {
    const errors = buildErrors(fixture);
    expect(errors.length).toBeGreaterThan(0);
    const known = [
      ...MISSING_COLUMNS.map(([table, column]) => new RegExp(`(no column '${column}' on ${table}|'${column}' is text, not an integer key)`)),
      /invites\.notifications\.invitee: 'email' is text, not an integer key/,
    ];
    // Every error is one of the model's known mistakes...
    for (const e of errors) expect(known.some(k => k.test(e)), e).toBe(true);
    // ...and every known mistake is reported.
    for (const k of known) expect(errors.some(e => k.test(e)), String(k)).toBe(true);
  });

  test("with its schema completed to what its rules assume, it builds", () => {
    expect(buildErrors(patchedModelingDomain())).toEqual([]);
  });

  test("no rule compiles to FALSE, and every owner-only rule keeps role=owner", () => {
    let owner = 0;
    for (const { where, rule } of rules) {
      const table = where.split(".")[0];
      const sql = compilePermission(table, rule, null, "p_data");
      expect(sql, `${where}: ${rule}`).not.toContain("FALSE");
      if (/role=owner/.test(rule)) {
        owner++;
        expect(sql, `${where}: ${rule}`).toContain(".role = 'owner'");
      }
    }
    expect(owner).toBe(19);
  });
});
