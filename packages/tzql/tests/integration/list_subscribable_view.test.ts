import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { compileDomain } from "../../src/cli/compile.js";
import { patchedModelingDomain } from "../fixtures/modeling-dzql.patched.js";

// A list subscribable's get returns only the root rows the subscriber may view:
// the root entity's view rules are part of the list query, beside root.filter.
// Checks every persona: each receives exactly the rows they may view, and
// nobody else's.

const PAT = 1;   // owner of org 10, which promotes occasion 100 and owns venue 601
const MO = 2;    // member of org 10
const SAM = 3;   // member of org 20, which has an offer on package 1000
const ZED = 4;   // owner of org 30, which promotes occasion 101 and owns venue 602
const AVA = 5;   // member of org 40, the authority for series 500
const VIC = 6;   // member of org 50, which owns venue 600
const ANON = null;
const EVERYONE = [PAT, MO, SAM, ZED, AVA, VIC, ANON] as const;
type Persona = typeof EVERYONE[number];
const name = (p: Persona) => ({ 1: "Pat", 2: "Mo", 3: "Sam", 4: "Zed", 5: "Ava", 6: "Vic" } as any)[p as any] ?? "anonymous";

describe("list subscribables apply the root entity's view rules", () => {
  let db: V2TestDatabase;
  let sql: any;

  /** The ids each persona receives from list subscribable sub, or "denied". */
  async function received(sub: string): Promise<Record<string, number[] | "denied">> {
    const out: Record<string, number[] | "denied"> = {};
    for (const p of EVERYONE) {
      try {
        const rows = await sql`SELECT * FROM dzql_v2.${sql.unsafe(`get_${sub}`)}(${sql.json({})}, ${p}) AS r`;
        out[name(p)] = rows.map((x: any) => x.r.id).sort((a: number, b: number) => a - b);
      } catch (e: any) {
        if (!/permission_denied/.test(String(e.message))) {
          throw new Error(`${name(p)}: expected rows or permission_denied, got: ${e.message}`);
        }
        out[name(p)] = "denied";
      }
    }
    return out;
  }

  beforeAll(async () => {
    const domain = patchedModelingDomain();
    // venues.view: @org_id->user_orgs[org_id=$].user_id (one hop)
    domain.subscribables.all_venues = {
      params: {}, root: { entity: "venues" }, scopeTables: ["venues"], canSubscribe: ["TRUE"],
    };
    domain.subscribables.member_venues = {
      params: {}, root: { entity: "venues" }, scopeTables: ["venues"], canSubscribe: ["AUTHENTICATED"],
    };
    // packages.view: two rules, each a multi-hop chain with a filtered middle hop
    domain.subscribables.all_packages = {
      params: {}, root: { entity: "packages" }, includes: { occasion: "occasions" },
      scopeTables: ["packages", "occasions"], canSubscribe: ["TRUE"],
    };
    // root.filter and the view rules both apply
    domain.subscribables.gold_packages = {
      params: {}, root: { entity: "packages", filter: { name: "Gold" } },
      scopeTables: ["packages"], canSubscribe: ["TRUE"],
    };

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
      INSERT INTO users (id, email) VALUES (1,'pat@x'),(2,'mo@x'),(3,'sam@x'),(4,'zed@x'),(5,'ava@x'),(6,'vic@x');
      INSERT INTO organisations (id, name) VALUES (10,'Promoter'),(20,'Sponsor'),(30,'Other promoter'),(40,'Authority'),(50,'Venue owner');
      INSERT INTO user_orgs (org_id, user_id, role) VALUES (10,1,'owner'),(10,2,'member'),(20,3,'member'),(30,4,'owner'),(40,5,'member'),(50,6,'member');
      INSERT INTO series (id, authority_org_id, name) VALUES (500, 40, 'Summer');
      INSERT INTO venues (id, org_id, name) VALUES (600, 50, 'Hall'), (601, 10, 'Club'), (602, 30, 'Arena'), (603, NULL, 'Orphan');
      INSERT INTO occasions (id, series_id, venue_id, name) VALUES (100, 500, 600, 'Ours'), (101, 500, NULL, 'Theirs');
      INSERT INTO occasion_promoters (id, occasion_id, promoter_id) VALUES (700, 100, 10), (701, 101, 30);
      INSERT INTO packages (id, occasion_id, name) VALUES (1000, 100, 'Gold'), (1001, 101, 'Silver'), (1002, 101, 'Gold');
      INSERT INTO package_offers (id, package_id, sponsor_id) VALUES (800, 1000, 20);
    `);
  });

  afterAll(async () => {
    await db?.teardown();
  });

  test("venues (one-hop rule): each member sees only their org's venues", async () => {
    expect(await received("all_venues")).toEqual({
      Pat: [601], Mo: [601], Sam: [], Zed: [602], Ava: [], Vic: [600], anonymous: [],
    });
  });

  test("canSubscribe still applies first: AUTHENTICATED denies anonymous", async () => {
    expect(await received("member_venues")).toEqual({
      Pat: [601], Mo: [601], Sam: [], Zed: [602], Ava: [], Vic: [600], anonymous: "denied",
    });
  });

  test("packages (any of two multi-hop rules): promoters and sponsors see their own", async () => {
    expect(await received("all_packages")).toEqual({
      Pat: [1000], Mo: [1000], Sam: [1000], Zed: [1001, 1002], Ava: [], Vic: [], anonymous: [],
    });
  });

  test("root.filter narrows the viewable rows further", async () => {
    expect(await received("gold_packages")).toEqual({
      Pat: [1000], Mo: [1000], Sam: [1000], Zed: [1002], Ava: [], Vic: [], anonymous: [],
    });
  });
});
