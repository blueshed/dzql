import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { compileDomain } from "../../src/cli/compile.js";

// Realtime pushes for a subscription must reach only subscribers who may see the
// row: <name>_can_receive(user, params, table, op, data) answers 'row' (send it),
// 'pk' (send only its key: a delete), or NULL (send nothing). For a list, the
// initial fetch already applies the root's view rules; pushes must agree with it.

const PAT = 1;   // member of org 10, which owns venue 600
const ZED = 4;   // member of org 30, which owns venue 601
const ANON = null;
const EVERYONE = [PAT, ZED, ANON] as const;
const name = (p: number | null) => (({ 1: "Pat", 4: "Zed" } as any)[p as any] ?? "anon");

const domain: any = {
  entities: {
    users: { schema: { id: "serial PRIMARY KEY", email: "text" }, permissions: { view: ["@id"] } },
    user_orgs: {
      schema: { id: "serial PRIMARY KEY", org_id: "int", user_id: "int REFERENCES users(id)" },
      permissions: { view: ["@org_id->user_orgs[org_id=$].user_id"] },
    },
    venues: {
      schema: { id: "serial PRIMARY KEY", org_id: "int", name: "text" },
      permissions: { view: ["@org_id->user_orgs[org_id=$].user_id"] },
    },
    sites: {
      schema: { id: "serial PRIMARY KEY", venue_id: "int REFERENCES venues(id)", name: "text" },
      permissions: { view: ["@venue_id->venues.org_id->user_orgs[org_id=$].user_id"] },
    },
  },
  subscribables: {
    all_venues: {
      params: {}, root: { entity: "venues" },
      includes: { sites: { entity: "sites", filter: { venue_id: "@id" } } },
      scopeTables: ["venues", "sites"],
      canSubscribe: ["AUTHENTICATED"],
    },
    venue_detail: {
      params: { venue_id: "int" }, root: { entity: "venues", key: "venue_id" },
      includes: { sites: { entity: "sites", filter: { venue_id: "@id" } } },
      scopeTables: ["venues", "sites"],
      canSubscribe: ["@org_id->user_orgs[org_id=$].user_id"],
    },
  },
};

describe("realtime pushes reach only subscribers who may see the row", () => {
  let db: V2TestDatabase;
  let sql: any;

  const receive = async (sub: string, params: object, table: string, op: string, data: object) => {
    const out: Record<string, string | null> = {};
    for (const p of EVERYONE) {
      const [{ r }] = await sql`
        SELECT dzql_v2.${sql.unsafe(`${sub}_can_receive`)}(${p}, ${sql.json(params)}, ${table}, ${op}, ${sql.json(data)}) AS r`;
      out[name(p)] = r;
    }
    return out;
  };

  beforeAll(async () => {
    const log = console.log;
    console.log = () => {};
    const compiled = compileDomain(domain);
    console.log = log;

    db = new V2TestDatabase();
    sql = await db.setup();
    await sql.unsafe(compiled.coreSQL);
    await sql.unsafe(compiled.schemaSQL);
    await sql.unsafe(compiled.subscribableSQL);
    await sql.unsafe(`
      INSERT INTO users (id, email) VALUES (1,'pat'),(4,'zed');
      INSERT INTO user_orgs (org_id, user_id) VALUES (10,1),(30,4);
      INSERT INTO venues (id, org_id, name) VALUES (600, 10, 'Ours'), (601, 30, 'Theirs');
      INSERT INTO sites (id, venue_id, name) VALUES (900, 600, 'Our site'), (901, 601, 'Their site');
    `);
  });

  afterAll(async () => {
    await db?.teardown();
  });

  describe("list subscription", () => {
    test("a root row goes only to those who may view it", async () => {
      expect(await receive("all_venues", {}, "venues", "update", { id: 600, org_id: 10, name: "Ours" }))
        .toEqual({ Pat: "row", Zed: null, anon: null });
      expect(await receive("all_venues", {}, "venues", "insert", { id: 601, org_id: 30, name: "Theirs" }))
        .toEqual({ Pat: null, Zed: "row", anon: null });
    });

    test("a root delete goes, as its key, only to those who could view it", async () => {
      expect(await receive("all_venues", {}, "venues", "delete", { id: 600, org_id: 10, name: "Ours" }))
        .toEqual({ Pat: "pk", Zed: null, anon: null });
    });

    test("an included row goes only to those whose documents show it", async () => {
      expect(await receive("all_venues", {}, "sites", "update", { id: 900, venue_id: 600, name: "Our site" }))
        .toEqual({ Pat: "row", Zed: null, anon: null });
      expect(await receive("all_venues", {}, "sites", "update", { id: 901, venue_id: 601, name: "Their site" }))
        .toEqual({ Pat: null, Zed: "row", anon: null });
    });

    test("an included delete carries only its key, and never to someone who can't subscribe", async () => {
      expect(await receive("all_venues", {}, "sites", "delete", { id: 900, venue_id: 600, name: "Our site" }))
        .toEqual({ Pat: "pk", Zed: "pk", anon: null });
    });

    test("a table outside the document reaches nobody", async () => {
      expect(await receive("all_venues", {}, "user_orgs", "update", { id: 1, org_id: 10, user_id: 1 }))
        .toEqual({ Pat: null, Zed: null, anon: null });
    });
  });

  describe("single-document subscription", () => {
    test("canSubscribe is the gate: rows of the document go to those who may subscribe", async () => {
      expect(await receive("venue_detail", { venue_id: 600 }, "sites", "update", { id: 900, venue_id: 600 }))
        .toEqual({ Pat: "row", Zed: null, anon: null });
      expect(await receive("venue_detail", { venue_id: 600 }, "sites", "delete", { id: 900, venue_id: 600 }))
        .toEqual({ Pat: "pk", Zed: null, anon: null });
    });
  });
});
