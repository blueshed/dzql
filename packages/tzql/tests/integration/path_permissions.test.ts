import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { compileDomain } from "../../src/cli/compile.js";
import { patchedModelingDomain } from "../fixtures/modeling-dzql.patched.js";

// Runs modeling-dzql's real permission rules through the SQL the compiler
// produces (document-proofs R6), and checks every persona for every action:
// who may, and that everyone else may not (R3). A refusal counts only if it is
// permission_denied; any other SQL error fails the test (law 16: no false green).

const PAT = 1;   // owner of org 10, which promotes occasion 100
const MO = 2;    // member (not owner) of org 10
const SAM = 3;   // member of org 20, which has an offer on package 1000
const ZED = 4;   // owner of org 30, which promotes occasion 101
const AVA = 5;   // member of org 40, the authority for series 500
const VIC = 6;   // member of org 50, which owns venue 600
const ANON = null;
const EVERYONE = [PAT, MO, SAM, ZED, AVA, VIC, ANON] as const;
type Persona = typeof EVERYONE[number];
const name = (p: Persona) => ({ 1: "Pat", 2: "Mo", 3: "Sam", 4: "Zed", 5: "Ava", 6: "Vic" } as any)[p as any] ?? "anonymous";

describe("modeling-dzql rules, enforced by the generated SQL", () => {
  let db: V2TestDatabase;
  let sql: any;
  let seq = 5000;

  /** Run fn as each persona; return the names of those it was allowed for. */
  async function allowed(fn: (p: Persona) => Promise<unknown>): Promise<string[]> {
    const ok: string[] = [];
    for (const p of EVERYONE) {
      try {
        await fn(p);
        ok.push(name(p));
      } catch (e: any) {
        if (!/permission_denied/.test(String(e.message))) {
          throw new Error(`${name(p)}: expected success or permission_denied, got: ${e.message}`);
        }
      }
    }
    return ok;
  }

  /** Who can see row id through fn (which returns rows or a row). */
  async function seers(fn: (p: Persona) => Promise<any[]>, id: number): Promise<string[]> {
    const who: string[] = [];
    for (const p of EVERYONE) {
      const rows = await fn(p);
      if (rows.some((r: any) => r && (r.id === id || r.value === id))) who.push(name(p));
    }
    return who;
  }

  const save = (table: string, p: Persona, data: object) =>
    sql`SELECT dzql_v2.${sql.unsafe(`save_${table}`)}(${p}, ${sql.json(data)}) AS r`;
  const del = (table: string, p: Persona, id: number) =>
    sql`SELECT dzql_v2.${sql.unsafe(`delete_${table}`)}(${p}, ${sql.json({ id })}) AS r`;
  const get = async (table: string, p: Persona, id: number) =>
    (await sql`SELECT dzql_v2.${sql.unsafe(`get_${table}`)}(${p}, ${sql.json({ id })}) AS r`).map((x: any) => x.r);
  const search = async (table: string, p: Persona) =>
    (await sql`SELECT * FROM dzql_v2.${sql.unsafe(`search_${table}`)}(${p}, ${sql.json({ limit: 1000 })}) AS r`).map((x: any) => x.r);
  const lookup = async (table: string, p: Persona) =>
    (await sql`SELECT * FROM dzql_v2.${sql.unsafe(`lookup_${table}`)}(${p}, ${sql.json({ limit: 1000 })}) AS r`).map((x: any) => x.r);
  const canSubscribe = async (sub: string, p: Persona, params: object) =>
    (await sql`SELECT dzql_v2.${sql.unsafe(`${sub}_can_subscribe`)}(${p}, ${sql.json(params)}) AS ok`)[0].ok;

  beforeAll(async () => {
    const domain = patchedModelingDomain();
    // Extra subscribables beside the model's own (which all have canSubscribe: []):
    // the same view gated by the root entity's own view rules, and a list.
    domain.subscribables.package_view_ruled = {
      ...domain.subscribables.package_view,
      canSubscribe: domain.entities.packages.permissions.view,
    };
    domain.subscribables.all_series = { params: {}, root: { entity: "series" }, scopeTables: ["series"], canSubscribe: ["AUTHENTICATED"] };

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
      INSERT INTO venues (id, org_id, name) VALUES (600, 50, 'Hall');
      INSERT INTO occasions (id, series_id, venue_id, name) VALUES (100, 500, 600, 'Ours'), (101, 500, NULL, 'Theirs');
      INSERT INTO occasion_promoters (id, occasion_id, promoter_id) VALUES (700, 100, 10), (701, 101, 30);
      INSERT INTO packages (id, occasion_id, name) VALUES (1000, 100, 'Gold'), (1001, 101, 'Silver');
      INSERT INTO package_offers (id, package_id, sponsor_id) VALUES (800, 1000, 20);
    `);
  });

  afterAll(async () => {
    await db?.teardown();
  });

  describe("promoter of this occasion (filtered middle hop)", () => {
    test("only the occasion's promoters may create a package on it", async () => {
      expect(await allowed(p => save("packages", p, { occasion_id: 100, name: `new by ${name(p)}` })))
        .toEqual(["Pat", "Mo"]);
    });

    test("only the occasion's promoters may update its package", async () => {
      expect(await allowed(p => save("packages", p, { id: 1000, occasion_id: 100, name: `edit by ${name(p)}` })))
        .toEqual(["Pat", "Mo"]);
    });

    test("the update is checked against the stored row, not the body", async () => {
      // Zed promotes 101, not 100: naming 101 in the body must not let Zed edit 1000.
      // (Pat and Mo are refused too: they don't promote 101, the row's new occasion.)
      expect(await allowed(async p => {
        await sql`UPDATE packages SET occasion_id = 100 WHERE id = 1000`;
        await save("packages", p, { id: 1000, occasion_id: 101, name: "moved" });
      })).toEqual([]);
      await sql`UPDATE packages SET occasion_id = 100, name = 'Gold' WHERE id = 1000`;
    });

    test("an editor cannot move the package to an occasion they don't promote", async () => {
      // Pat and Mo may edit 1000 (on 100), but 101 belongs to Zed's org: the row
      // as it will be after the update must pass the update rule too.
      expect(await allowed(async p => {
        await sql`UPDATE packages SET occasion_id = 100 WHERE id = 1000`;
        await save("packages", p, { id: 1000, occasion_id: 101 });
      })).toEqual([]);
      const [row] = await sql`SELECT occasion_id FROM packages WHERE id = 1000`;
      expect(row.occasion_id).toBe(100);
    });

    test("an editor may move the package to another occasion they promote", async () => {
      await sql`INSERT INTO occasions (id, series_id, name) VALUES (102, 500, 'Also ours')`;
      await sql`INSERT INTO occasion_promoters (id, occasion_id, promoter_id) VALUES (702, 102, 10)`;
      try {
        expect(await allowed(async p => {
          await sql`UPDATE packages SET occasion_id = 100 WHERE id = 1000`;
          await save("packages", p, { id: 1000, occasion_id: 102 });
        })).toEqual(["Pat", "Mo"]);
      } finally {
        await sql`UPDATE packages SET occasion_id = 100, name = 'Gold' WHERE id = 1000`;
        await sql`DELETE FROM occasion_promoters WHERE id = 702`;
        await sql`DELETE FROM occasions WHERE id = 102`;
      }
    });

    test("only an owner of the promoting org may delete a package ([org_id=$,role=owner] in a chain)", async () => {
      expect(await allowed(async p => {
        const id = ++seq;
        await sql`INSERT INTO packages (id, occasion_id, name) VALUES (${id}, 100, 'doomed')`;
        await del("packages", p, id);
      })).toEqual(["Pat"]);
    });

    test("get: the occasion's promoters and the package's sponsor see it; nobody else does", async () => {
      expect(await seers(p => get("packages", p, 1000), 1000)).toEqual(["Pat", "Mo", "Sam"]);
      expect(await seers(p => get("packages", p, 1001), 1001)).toEqual(["Zed"]);
    });

    test("search sees the same rows as get", async () => {
      expect(await seers(p => search("packages", p), 1000)).toEqual(["Pat", "Mo", "Sam"]);
      expect(await seers(p => search("packages", p), 1001)).toEqual(["Zed"]);
    });

    test("lookup sees the same rows as get", async () => {
      expect(await seers(p => lookup("packages", p), 1000)).toEqual(["Pat", "Mo", "Sam"]);
      expect(await seers(p => lookup("packages", p), 1001)).toEqual(["Zed"]);
    });

    test("notifications reach the occasion's promoters and the package's sponsor", async () => {
      const notified = async (actor: number) => {
        const [{ users }] = await sql`
          SELECT dzql_v2.packages_notify_users(${actor}, row_to_json(p)::jsonb) AS users FROM packages p WHERE id = 1000`;
        return [...users].sort();
      };
      // An actor outside the domain's users: everyone the paths lead to.
      expect(await notified(99)).toEqual([PAT, MO, SAM]);
      // The user who made the change isn't notified of it.
      expect(await notified(PAT)).toEqual([MO, SAM]);
    });
  });

  describe("a rule that checks its own table", () => {
    test("occasion_promoters: each promoter sees only their own occasion's rows", async () => {
      expect(await seers(p => get("occasion_promoters", p, 700), 700)).toEqual(["Pat", "Mo"]);
      expect(await seers(p => get("occasion_promoters", p, 701), 701)).toEqual(["Zed"]);
      expect(await seers(p => search("occasion_promoters", p), 701)).toEqual(["Zed"]);
    });
  });

  describe("owner-only ([org_id=$,role=owner])", () => {
    test("only an owner may update the organisation; a member may not", async () => {
      expect(await allowed(p => save("organisations", p, { id: 10, name: `renamed by ${name(p)}` }))).toEqual(["Pat"]);
    });

    test("only an owner may add a member", async () => {
      expect(await allowed(async p => {
        try {
          await save("user_orgs", p, { org_id: 10, user_id: 6, role: "member" });
        } finally {
          await sql`DELETE FROM user_orgs WHERE org_id = 10 AND user_id = 6`;
        }
      })).toEqual(["Pat"]);
    });
  });

  describe("every rule in a list is enforced", () => {
    test("the series authority or the venue's org may apply; nobody else", async () => {
      expect(await allowed(p => save("venue_series_applications", p, { series_id: 500, venue_id: 600, status: "applied" })))
        .toEqual(["Ava", "Vic"]);
    });
  });

  describe("an empty list denies everyone", () => {
    test("organisations.create: []", async () => {
      expect(await allowed(p => save("organisations", p, { name: `org by ${name(p)}` }))).toEqual([]);
    });

    test("package_offers.update: []", async () => {
      expect(await allowed(p => save("package_offers", p, { id: 800, package_id: 1000, sponsor_id: 20 }))).toEqual([]);
    });
  });

  describe("subscriptions", () => {
    test("canSubscribe: [] denies everyone, as the model records no view access", async () => {
      for (const p of EVERYONE) expect(await canSubscribe("package_view", p, { package_id: 1000 })).toBe(false);
    });

    test("a view gated by the package's own view rules admits exactly the package's viewers", async () => {
      const who: string[] = [];
      for (const p of EVERYONE) if (await canSubscribe("package_view_ruled", p, { package_id: 1000 })) who.push(name(p));
      expect(who).toEqual(["Pat", "Mo", "Sam"]);
    });

    test("a list subscribable with AUTHENTICATED admits signed-in users only", async () => {
      const who: string[] = [];
      for (const p of EVERYONE) if (await canSubscribe("all_series", p, {})) who.push(name(p));
      expect(who).toEqual(["Pat", "Mo", "Sam", "Zed", "Ava", "Vic"]);
    });
  });
});
